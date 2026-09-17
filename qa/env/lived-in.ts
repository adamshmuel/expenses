/**
 * Builds the four lived-in accounts — qa/specs/env-lived-in.md — in their
 * OWN persistent database (`LIVED_IN_DB_NAME`), separate from the
 * fresh-account `expenses_qa_test` database.
 *
 * **Persistent, not torn down.** Adam asked to keep using these accounts
 * himself after a run finishes (see the coordinator note this file's
 * comments below reference), so nothing here ever drops this database at
 * teardown -- qa/e2e/globalTeardown.ts only ever touches `expenses_qa_test`.
 *
 * **Rebuilt at the START of every run, not accumulated onto.** A persistent
 * database and a deterministic suite pull against each other: if a case
 * mutates lv_corrector's expenses and nothing resets them, the next run
 * is no longer testing the environment the spec describes. The fix used
 * here is the same one a schema migration uses -- `seedLivedIn()` drops
 * every collection in `LIVED_IN_DB_NAME` and rebuilds it from the checked-in
 * corpus (qa/data/sentence-corpus.ts) before a single test runs, every time.
 * That keeps the run deterministic (same starting state every time) while
 * leaving the four accounts populated and usable in between runs -- exactly
 * the property Adam asked for. The rebuild is a few seconds of direct model
 * writes (env-lived-in.md §6), not a network call.
 *
 * Accounts are created through the real business logic
 * (`bl/userService.signup`, `bl/categoryService.createCategory`), never a
 * raw insert, so schema defaults/validators/hooks apply exactly as they do
 * in production (env-lived-in.md §4). Background history (expenses,
 * messages) is written with the server's own Mongoose models directly, per
 * the same section -- the interaction *under test* is always driven through
 * the real path instead (the flow specs' own cases do that; this file only
 * builds scenery).
 *
 * Runs inside Playwright's `globalSetup`, which the project's own comment
 * (qa/e2e/globalSetup.ts) says executes BEFORE the webServers start -- so no
 * HTTP call to the server is available here, only direct model/service
 * calls. That is why signup goes through `userService.signup` (a plain
 * function call) rather than `POST /users/signup`.
 *
 * One deliberate wrinkle: `userService.signup` always stamps `createdAt` as
 * "now". A lived-in account is supposed to be weeks old, and
 * LV-19/env-lived-in.md §2 requires every expense date to be no earlier than
 * its owner's `createdAt` -- so after the real signup we directly back-date
 * the User document's `createdAt` to before the account's oldest seeded
 * expense. That single field write is the one place this file writes
 * something the app itself would never produce naturally; it exists only so
 * the *rest* of the seeded data (which the app's own code paths generated)
 * is temporally consistent. Documented here rather than done quietly.
 */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { readBackendEnv, deriveTestMongoUri } from "../harness/env.js";
import { LIVED_IN_DB_NAME } from "../harness/paths.js";
import { CORPUS, type CorpusItem } from "../data/sentence-corpus.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "backend");
const FIXTURES_PATH = resolve(here, ".lived-in-fixtures.json");

export const LIVED_IN_PASSWORD = "LivedIn!2026";

export interface SeededCategory {
  _id: string;
  name: string;
  parent: string | null;
}

export interface LivedInAccount {
  username: string;
  password: string;
  userId: string;
  categories: SeededCategory[];
  expenseCount: number;
  messageCount: number;
}

export interface LivedInFixtures {
  lv_steady: LivedInAccount;
  lv_coffee: LivedInAccount;
  lv_sprawl: LivedInAccount;
  lv_corrector: LivedInAccount;
}

// ---------------------------------------------------------------- helpers --

function utcMidnight(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

/** Weekday-weighted day-offsets (Mon-Thu heavier than Fri-Sat), guaranteeing
 *  no gap longer than 3 consecutive days, for exactly `count` expenses
 *  spread across the last `spanDays` days ending `endDaysAgo` days ago.
 *  Approximate by design (env-lived-in.md asks for a realistic spread, not a
 *  statistical model) -- documented, not hidden. */
function spreadDayOffsets(count: number, spanDays: number, endDaysAgo: number): number[] {
  const offsets: number[] = []; // days-ago values, oldest first
  const weight = (daysAgo: number) => {
    const dow = utcMidnight(daysAgo).getUTCDay(); // 0=Sun..6=Sat
    if (dow >= 1 && dow <= 4) return 1.3; // Mon-Thu
    if (dow === 5 || dow === 6) return 0.7; // Fri-Sat
    return 1.0; // Sun
  };
  const days = Array.from({ length: spanDays }, (_, i) => endDaysAgo + (spanDays - 1 - i));
  const weights = days.map(weight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / totalWeight) * count);
  const base = raw.map(Math.floor);
  let remainder = count - base.reduce((a, b) => a + b, 0);
  const fracOrder = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) base[fracOrder[k % fracOrder.length].i] += 1;

  // Enforce "no gap longer than 3 consecutive days": any run of 3 zero-days
  // borrows one from the richest neighbour.
  for (let i = 0; i + 2 < base.length; i++) {
    if (base[i] === 0 && base[i + 1] === 0 && base[i + 2] === 0) {
      const richest = base.reduce((best, v, idx) => (v > base[best] ? idx : best), 0);
      if (base[richest] > 1) {
        base[richest] -= 1;
        base[i + 1] += 1;
      } else {
        base[i + 1] += 1; // tiny account: just accept one extra
      }
    }
  }

  days.forEach((d, i) => {
    for (let n = 0; n < base[i]; n++) offsets.push(d);
  });
  // Trim/pad to exactly `count` (rounding can drift by one).
  while (offsets.length > count) offsets.pop();
  while (offsets.length < count) offsets.push(endDaysAgo);
  return offsets;
}

function catalogueCycle(n: number): CorpusItem[] {
  const pool = CORPUS.flatMap((s) => s.items);
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

interface CategoryIndex {
  byMainSub: Map<string, SeededCategory>; // "Main>Sub" or "Main"
}

function indexCategories(categories: SeededCategory[]): CategoryIndex {
  const byId = new Map(categories.map((c) => [c._id, c]));
  const byMainSub = new Map<string, SeededCategory>();
  for (const c of categories) {
    if (!c.parent) byMainSub.set(c.name, c);
  }
  for (const c of categories) {
    if (c.parent) {
      const parent = byId.get(c.parent);
      if (parent) byMainSub.set(`${parent.name}>${c.name}`, c);
    }
  }
  return { byMainSub };
}

function resolveCategoryId(idx: CategoryIndex, main: string, sub: string | null): string {
  const key = sub ? `${main}>${sub}` : main;
  const hit = idx.byMainSub.get(key) ?? idx.byMainSub.get(main) ?? idx.byMainSub.get("Other");
  if (!hit) throw new Error(`No category resolvable for ${key}`);
  return hit._id;
}

// ------------------------------------------------------------------- main --

export async function seedLivedIn(): Promise<LivedInFixtures> {
  const require_ = createRequire(resolve(BACKEND, "package.json"));
  const mongoose = require_("mongoose") as typeof import("mongoose");
  const be = readBackendEnv();
  const uri = deriveTestMongoUri(be.MONGODB_URI, LIVED_IN_DB_NAME);
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri);
  }
  // userService.signup() (called via makeAccount() below) reads
  // process.env.JWT_SECRET/REFRESH_TOKEN_SECRET directly -- unlike the
  // spawned webServer children, THIS process never had them set (readBackendEnv()
  // only returns them as a plain object for the webServer's own `env:`).
  // Real bug found running this for the first time: "secretOrPrivateKey
  // must have a value" from jwt.sign inside issueTokenPair.
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = be.JWT_SECRET;
  if (!process.env.REFRESH_TOKEN_SECRET) process.env.REFRESH_TOKEN_SECRET = be.REFRESH_TOKEN_SECRET;

  // Rebuild from scratch every run (see file header) -- a persistent
  // database and a deterministic suite otherwise pull against each other.
  await mongoose.connection.dropDatabase();

  const userService = require_("./bl/userService.js");
  const categoryService = require_("./bl/categoryService.js");
  const User = require_("./models/userModel.js");
  const Category = require_("./models/categoryModel.js");
  const Expense = require_("./models/expenseModel.js");
  const Message = require_("./models/messageModel.js");

  async function makeAccount(username: string, spanDays: number, endDaysAgo: number): Promise<{ userId: string; categories: SeededCategory[] }> {
    const { user } = await userService.signup({
      username,
      email: `${username}@lived-in.qa`,
      password: LIVED_IN_PASSWORD,
    });
    const userId = String(user._id);
    // Back-date the account itself (see file header) so every seeded
    // expense/message legitimately post-dates its owner's createdAt.
    await User.findByIdAndUpdate(userId, { createdAt: utcMidnight(spanDays + endDaysAgo + 3) });

    const cats = await Category.find({ owner: userId }).lean();
    const categories: SeededCategory[] = cats.map((c: any) => ({
      _id: String(c._id),
      name: c.name,
      parent: c.parent ? String(c.parent) : null,
    }));
    return { userId, categories };
  }

  async function addCategory(userId: string, name: string, parent?: string) {
    const created = await categoryService.createCategory(userId, { name, parent });
    return { _id: String(created._id), name: created.name, parent: created.parent ? String(created.parent) : null };
  }

  const LABELS = ["store", "description"] as const; // seeded 2:4 store:description, never both (env-lived-in.md §2)
  function labelFor(index: number, item: CorpusItem) {
    // Exactly 2 of every 6 use `store`, the other 4 use `description` --
    // matches the measured live-database ratio in the spec.
    return index % 6 < 2 ? { store: item.label } : { description: item.label };
  }

  async function writeExpenses(
    userId: string,
    idx: CategoryIndex,
    count: number,
    spanDays: number,
    endDaysAgo: number,
  ): Promise<number> {
    const offsets = spreadDayOffsets(count, spanDays, endDaysAgo);
    const items = catalogueCycle(count);
    const docs = offsets.map((daysAgo, i) => {
      const date = utcMidnight(daysAgo);
      const item = items[i];
      return {
        amount: item.amount,
        ...labelFor(i, item),
        date,
        category: resolveCategoryId(idx, item.categoryMain, item.categorySub),
        user: userId,
        createdAt: date,
        updatedAt: date,
      };
    });
    await Expense.insertMany(docs);
    return docs.length;
  }

  /** Explicit ambiguity-cluster rows (env-lived-in.md §3), inserted on top of
   *  the generic spread so LV-04..LV-09 have something concrete to match. */
  async function writeCluster(
    userId: string,
    idx: CategoryIndex,
    label: "store" | "description",
    name: string,
    amounts: number[],
    daysAgoEach: number[],
    main: string,
    sub: string | null,
  ) {
    const category = resolveCategoryId(idx, main, sub);
    const docs = amounts.map((amount, i) => {
      const date = utcMidnight(daysAgoEach[i]);
      return {
        amount,
        [label]: name,
        date,
        category,
        user: userId,
        createdAt: date,
        updatedAt: date,
      };
    });
    await Expense.insertMany(docs);
    return docs.length;
  }

  const CHAT_LINES: [string, string][] = [
    ["spent 20 on lunch", "Got it — 20 filed under Food › Restaurants."],
    ["paid the electricity bill, 340", "Filed 340 under Home › Utilities."],
    ["30 at the pharmacy", "Filed 30 under Health."],
    ["bought a book for 60", "Filed 60 under Education."],
    ["coffee, 18", "Filed 18 under Food › Coffee."],
    ["gas, 220", "Filed 220 under Transport › Fuel."],
  ];

  async function writeMessages(userId: string, count: number, spanDays: number, endDaysAgo: number): Promise<number> {
    const pairs = Math.floor(count / 2);
    const offsets = spreadDayOffsets(pairs, spanDays, endDaysAgo);
    const docs: any[] = [];
    offsets.forEach((daysAgo, i) => {
      const [u, a] = CHAT_LINES[i % CHAT_LINES.length];
      const date = utcMidnight(daysAgo);
      docs.push({ text: u, role: "user", author: userId, createdAt: date, updatedAt: date });
      docs.push({ text: a, role: "assistant", author: userId, createdAt: date, updatedAt: date });
    });
    while (docs.length < count) {
      // top up to the exact count with a duplicate-safe pair near the newest day
      const date = utcMidnight(endDaysAgo);
      docs.push({ text: "spent 10 on coffee", role: "user", author: userId, createdAt: date, updatedAt: date });
    }
    await Message.insertMany(docs.slice(0, count));
    return count;
  }

  /** lv_corrector's history must end 21 days old, mid-exchange (an assistant
   *  question with no user reply after it) -- LV-16/LV-17. There is no
   *  server-side persistence of a "pending draft" at all (chatSlice.pending
   *  is client Redux state only, confirmed by reading HomePage.tsx/chatSlice.ts
   *  -- it is never rehydrated from loadChatHistory), so the only honest way
   *  to seed "a stale pending draft" is an unanswered assistant question at
   *  the tail of the transcript. Reported as a scoping note in the run
   *  report, not silently assumed. */
  async function writeCorrectorTailException(userId: string) {
    const date = utcMidnight(21);
    await Message.insertMany([
      { text: "spent 40 on parking", role: "user", author: userId, createdAt: date, updatedAt: date },
      { text: "How much was it?", role: "assistant", author: userId, createdAt: date, updatedAt: date },
    ]);
  }

  // ---- lv_steady: A2, 180 expenses / 60 days ending yesterday / 240 msgs --
  // env-lived-in.md §1 specifies "17 seeded + 3 user-made" categories --
  // found missing while implementing LV-11 (a category-row comparison test
  // needs the account to actually match its own environment spec).
  const steady = await makeAccount("lv_steady", 60, 1);
  const steadyExtraCats = [
    await addCategory(steady.userId, "Subscriptions", "Entertainment"),
    await addCategory(steady.userId, "Pet supplies"),
    await addCategory(steady.userId, "Gifts"),
  ];
  const steadyCategories = [...steady.categories, ...steadyExtraCats];
  const steadyIdx = indexCategories(steadyCategories);
  const steadyExpenseCount = await writeExpenses(steady.userId, steadyIdx, 180, 60, 1);
  const steadyMessageCount = await writeMessages(steady.userId, 240, 60, 1);

  // ---- lv_coffee: A3, 120 incl. 40 near-identical coffees / 56 days / 160 msgs --
  const coffee = await makeAccount("lv_coffee", 56, 0);
  const coffeeIdx = indexCategories(coffee.categories);
  const coffeeAmounts = Array.from({ length: 40 }, (_, i) => 12 + (i % 15)); // ₪12-26, several exact repeats
  const coffeeDays = spreadDayOffsets(40, 56, 0);
  await writeCluster(coffee.userId, coffeeIdx, "description", "coffee", coffeeAmounts, coffeeDays, "Food", "Coffee");
  const coffeeExpenseCount =
    40 + (await writeExpenses(coffee.userId, coffeeIdx, 80, 56, 0));
  const coffeeMessageCount = await writeMessages(coffee.userId, 160, 56, 0);

  // ---- lv_sprawl: A4, 150 expenses / 60 days / 32 categories, 3 near-dup clusters --
  const sprawl = await makeAccount("lv_sprawl", 60, 0);
  const extraCats: SeededCategory[] = [];
  extraCats.push(await addCategory(sprawl.userId, "Supermarket", "Food"));
  extraCats.push(await addCategory(sprawl.userId, "Food shopping", "Food"));
  extraCats.push(await addCategory(sprawl.userId, "Gas", "Transport"));
  extraCats.push(await addCategory(sprawl.userId, "Petrol", "Transport"));
  extraCats.push(await addCategory(sprawl.userId, "Chemist", "Health"));
  // 17 defaults + 5 near-dup siblings above = 22; top up to 32 with 10 plain user categories.
  const filler = ["Subscriptions", "Pets", "Hobbies", "Travel", "Gifts", "Software", "Garden", "Repairs", "Charity", "Kids"];
  for (const name of filler) extraCats.push(await addCategory(sprawl.userId, name));
  const sprawlCategories = [...sprawl.categories, ...extraCats];
  const sprawlIdx = indexCategories(sprawlCategories);
  const sprawlExpenseCount = await writeExpenses(sprawl.userId, sprawlIdx, 150, 60, 0);
  const sprawlMessageCount = await writeMessages(sprawl.userId, 200, 60, 0);

  // ---- lv_corrector: A5/A6, 90 expenses incl. 6 ambiguity clusters / 45 days / 300 msgs, last 21d old --
  const corrector = await makeAccount("lv_corrector", 45, 0);
  const extraCorrectorCats = [
    await addCategory(corrector.userId, "Streaming", "Entertainment"),
    await addCategory(corrector.userId, "Gifts"),
  ];
  const correctorCategories = [...corrector.categories, ...extraCorrectorCats];
  const correctorIdx = indexCategories(correctorCategories);
  let correctorCount = 0;
  correctorCount += await writeCluster(
    corrector.userId, correctorIdx, "description", "parking",
    [20, 20, 30, 20], [18, 12, 6, 2], "Transport", "Parking",
  );
  correctorCount += await writeCluster(
    corrector.userId, correctorIdx, "description", "pharmacy",
    [45, 38, 52], [25, 15, 5], "Health", null,
  );
  correctorCount += await writeCluster(
    corrector.userId, correctorIdx, "description", "supermarket",
    [120, 95, 140, 110, 130], [13, 10, 8, 5, 2], "Food", "Groceries",
  );
  correctorCount += await writeExpenses(corrector.userId, correctorIdx, 90 - correctorCount, 45, 0);
  const correctorMessageCount = await writeMessages(corrector.userId, 298, 45, 1);
  await writeCorrectorTailException(corrector.userId);

  const fixtures: LivedInFixtures = {
    lv_steady: {
      username: "lv_steady", password: LIVED_IN_PASSWORD, userId: steady.userId,
      categories: steadyCategories, expenseCount: steadyExpenseCount, messageCount: steadyMessageCount,
    },
    lv_coffee: {
      username: "lv_coffee", password: LIVED_IN_PASSWORD, userId: coffee.userId,
      categories: coffee.categories, expenseCount: coffeeExpenseCount, messageCount: coffeeMessageCount,
    },
    lv_sprawl: {
      username: "lv_sprawl", password: LIVED_IN_PASSWORD, userId: sprawl.userId,
      categories: sprawlCategories, expenseCount: sprawlExpenseCount, messageCount: sprawlMessageCount,
    },
    lv_corrector: {
      username: "lv_corrector", password: LIVED_IN_PASSWORD, userId: corrector.userId,
      categories: correctorCategories, expenseCount: correctorCount, messageCount: correctorMessageCount + 2,
    },
  };

  writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));
  return fixtures;
}

/** Disconnects the backend's own mongoose singleton this file connected in
 *  seedLivedIn() -- separate from harness/db.ts's own connection object. */
export async function disconnectLivedIn(): Promise<void> {
  const require_ = createRequire(resolve(BACKEND, "package.json"));
  const mongoose = require_("mongoose") as typeof import("mongoose");
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export function loadLivedInFixtures(): LivedInFixtures {
  if (!existsSync(FIXTURES_PATH)) {
    throw new Error(
      "qa/env/.lived-in-fixtures.json missing -- lived-in accounts have not been seeded this run (seedLivedIn() must run in globalSetup first).",
    );
  }
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));
}
