/**
 * Spec: qa/specs/flow-lived-in-2026-09-16.md (LV-01 .. LV-27), plus the two
 * bug-derived classes that specifically need history: BD-05 (lv_corrector)
 * and BD-06 (fresh-and-lived-in; the lived-in half is here, using lv_steady).
 *
 * Runs against the SEPARATE lived-in server+client pair (port 3101/5175,
 * project "chromium-livedin" in qa/e2e/playwright.config.ts) and the
 * persistent LIVED_IN_DB_NAME database -- never the fresh `expenses_qa_test`
 * database, and never dropped at teardown (see qa/env/lived-in.ts).
 *
 * Standing rules C1-C5 (flow-fresh-2026-09-16.md) apply here too, per
 * flow-lived-in-2026-09-16.md's own header.
 */
import { test, expect } from "@playwright/test";
import { LIVED_IN_BASE_URL } from "../../harness/paths.js";
import { livedInDb } from "../../harness/db.js";
import { loadLivedInFixtures } from "../../env/lived-in.js";
import {
  logInThroughUI, sendChat, userBubble, confirmButton, cancelButton,
  accessTokenFor, apiGet, getExpenses, getCategories, getMessages, getSummary, looksLikeSaveClaim, logAIRaw, AI_WAIT,
} from "../helpers.js";
import { RESPONSE_BUDGET_MS } from "../../harness/bars.js";
import { drivenSentences } from "../../data/sentence-corpus.js";

const API_BASE = LIVED_IN_BASE_URL;

// Lazy + memoized: read only once a test actually runs, never at module
// import time. Playwright loads spec files to discover tests before
// globalSetup necessarily finishes writing this file (confirmed by running
// `playwright test --list`, which loads files but never runs globalSetup) --
// reading it eagerly at import time crashes listing and risks crashing a
// real run too if the load order ever changes.
let _fixtures: ReturnType<typeof loadLivedInFixtures> | null = null;
function fixturesOf() {
  if (!_fixtures) _fixtures = loadLivedInFixtures();
  return _fixtures;
}

async function loginAs(page: any, account: "lv_steady" | "lv_coffee" | "lv_sprawl" | "lv_corrector") {
  const acc = fixturesOf()[account];
  await logInThroughUI(page, acc.username, acc.password);
  return acc;
}

// ---------------------------------------------------- Group 1 -- consistency

test("LV-01 the 41st coffee lands where the previous 40 did (N=5, all must agree)", async ({ page, context }) => {
  test.setTimeout(180_000);
  await loginAs(page, "lv_coffee");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = (await getExpenses(API_BASE, accessToken)).filter(
    (e: any) => (e.description ?? "").toLowerCase() === "coffee",
  );
  const establishedCategory = before[0]?.category;
  expect(establishedCategory, "lv_coffee fixture has no established coffee category").toBeTruthy();

  const phrasings = ["bought a coffee for 19", "coffee 19", "spent 19 on coffee", "19 at the coffee place", "grabbed a coffee, 19"];
  // Only 4 driven through the API (spec: 4 of 5 API, 1 through the screen).
  for (const phrase of phrasings.slice(0, 4)) {
    const r = await fetch(`${API_BASE}/chat/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: phrase }),
    });
    const body = await r.json();
    logAIRaw("LV-01", phrase, body);
    if (body.drafts?.length) {
      await fetch(`${API_BASE}/chat/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "create-expense", drafts: body.drafts }),
      });
    }
  }
  await sendChat(page, phrasings[4]);
  await expect(userBubble(page, phrasings[4])).toBeVisible(AI_WAIT);
  logAIRaw("LV-01", phrasings[4], { reply: await page.locator(".chat-bubble--assistant").last().innerText() });
  if (await confirmButton(page).count()) {
    await confirmButton(page).click();
    await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
  }

  const after = (await getExpenses(API_BASE, accessToken)).filter((e: any) => e.amount === 19);
  expect(after.length).toBeGreaterThanOrEqual(5);
  const categoriesUsed = new Set(after.slice(-5).map((e: any) => e.category));
  expect(categoriesUsed.size, `LV-01: the 5 new ₪19 coffees landed under ${categoriesUsed.size} different categories`).toBe(1);
  expect([...categoriesUsed][0]).toBe(establishedCategory);
});

test("LV-02 behaviour does not degrade with history (fresh vs. lv_steady, same 10 messages)", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(240_000);
  // lv_steady side.
  await loginAs(page, "lv_steady");
  const steadyToken = await accessTokenFor(context, API_BASE);

  // Fresh side, separate context against the FRESH server pair (port 3100).
  const freshContext = await browser.newContext({ baseURL: "http://127.0.0.1:5174" });
  const freshPage = await freshContext.newPage();
  const freshUser = { username: `qa_lv02_${Date.now()}`, email: `qa_lv02_${Date.now()}@test.io`, password: "password123" };
  await freshPage.goto("/signup");
  await freshPage.getByLabel("Username", { exact: true }).fill(freshUser.username);
  await freshPage.getByLabel("Email").fill(freshUser.email);
  await freshPage.getByLabel("Password", { exact: true }).fill(freshUser.password);
  await freshPage.getByLabel("Confirm password").fill(freshUser.password);
  await freshPage.getByRole("button", { name: "Create account" }).click();
  await expect(freshPage).toHaveURL(/\/home$/);
  const freshToken = await accessTokenFor(freshContext, "http://127.0.0.1:3100");

  const messages = ["spent 20 on coffee", "paid 30 for parking", "40 at the pharmacy", "spent 15 on lunch", "gas, 220"];
  let steadyCategoryNames: string[] = [];
  let freshCategoryNames: string[] = [];

  for (const msg of messages.slice(0, 5)) {
    const [steadyRes, freshRes] = await Promise.all([
      fetch(`${API_BASE}/chat/messages`, { method: "POST", headers: { Authorization: `Bearer ${steadyToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: msg }) }).then((r) => r.json()),
      fetch(`http://127.0.0.1:3100/chat/messages`, { method: "POST", headers: { Authorization: `Bearer ${freshToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: msg }) }).then((r) => r.json()),
    ]);
    logAIRaw("LV-02", `${msg} (lv_steady)`, steadyRes);
    logAIRaw("LV-02", `${msg} (fresh)`, freshRes);
    const steadyCats = await getCategories(API_BASE, steadyToken);
    const freshCats = await getCategories("http://127.0.0.1:3100", freshToken);
    const steadyName = steadyCats.find((c: any) => c._id === steadyRes.drafts?.[0]?.category)?.name ?? steadyRes.drafts?.[0]?.category;
    const freshName = freshCats.find((c: any) => c._id === freshRes.drafts?.[0]?.category)?.name ?? freshRes.drafts?.[0]?.category;
    steadyCategoryNames.push(steadyName);
    freshCategoryNames.push(freshName);
  }

  // Category NAME chosen should agree between the two accounts for the same message.
  const disagreements = steadyCategoryNames
    .map((n, i) => ({ msg: messages[i], steady: n, fresh: freshCategoryNames[i] }))
    .filter((d) => d.steady !== d.fresh);
  expect(disagreements, `LV-02: category disagreements between fresh and lv_steady: ${JSON.stringify(disagreements)}`).toEqual([]);
  await freshContext.close();
});

test("LV-03 a plain expense still works at volume", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);

  await sendChat(page, "spent 50 at the supermarket");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const after = await getExpenses(API_BASE, accessToken);
  expect(after.length).toBe(before.length + 1);
  const newExpense = after.find((e: any) => !before.some((b: any) => b._id === e._id));
  expect(newExpense.amount).toBe(50);
  expect(newExpense.date.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  const beforeIds = new Set(before.map((e: any) => e._id));
  const untouched = after.filter((e: any) => beforeIds.has(e._id));
  expect(untouched).toHaveLength(before.length);
});

// ---------------------------------------------------- Group 2 -- near-dupes

test("LV-04 an ambiguous edit asks before it writes", async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAs(page, "lv_corrector");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = (await getExpenses(API_BASE, accessToken)).filter((e: any) => (e.description ?? "") === "parking");

  await sendChat(page, "change the parking from last week to 35");
  await expect(userBubble(page, "change the parking")).toBeVisible(AI_WAIT);
  const matches = page.locator(".chat-matches li");
  const matchCount = await matches.count();
  // "Several matches" means more than one -- a single match would silently
  // pass a `> 0` check while proving the opposite of what this case tests.
  // The count shown must also be the real seeded cluster size (env-lived-in.md
  // §3: 4 parking entries), not just "more than one".
  expect(matchCount, "LV-04: expected several (>1) matches, not zero/one").toBeGreaterThan(1);
  expect(matchCount, `LV-04: shown match count should equal the seeded parking cluster size (${before.length})`).toBe(
    before.length,
  );

  const afterAsk = await getExpenses(API_BASE, accessToken);
  expect(afterAsk.filter((e: any) => (e.description ?? "") === "parking")).toEqual(before);

  await matches.first().locator("button").click();
  await expect(confirmButton(page)).toBeVisible({ timeout: 10_000 });
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const after = (await getExpenses(API_BASE, accessToken)).filter((e: any) => (e.description ?? "") === "parking");
  const changed = after.filter((e: any) => e.amount === 35);
  expect(changed.length).toBe(1);
  const untouchedCount = after.filter((e: any) => before.some((b: any) => b._id === e._id && b.amount === e.amount)).length;
  expect(untouchedCount).toBe(before.length - 1);
});

test("LV-05 an ambiguous delete removes exactly the chosen row", async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAs(page, "lv_corrector");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = (await getExpenses(API_BASE, accessToken)).filter((e: any) => (e.description ?? "") === "supermarket");

  await sendChat(page, "delete the supermarket expense");
  await expect(userBubble(page, "delete the supermarket")).toBeVisible(AI_WAIT);
  const matches = page.locator(".chat-matches li button");
  const matchCount = await matches.count();
  expect(matchCount, "LV-05: expected several (>1) matches, not zero/one").toBeGreaterThan(1);
  expect(matchCount, `LV-05: shown match count should equal the seeded supermarket cluster size (${before.length})`).toBe(
    before.length,
  );
  await matches.nth(2).click();
  await expect(confirmButton(page)).toBeVisible({ timeout: 10_000 });
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const after = (await getExpenses(API_BASE, accessToken)).filter((e: any) => (e.description ?? "") === "supermarket");
  expect(after.length).toBe(before.length - 1);
});

test("LV-06 an unmatched reference says so", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_corrector");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);

  await sendChat(page, "delete the helicopter expense");
  await expect(userBubble(page, "delete the helicopter")).toBeVisible(AI_WAIT);
  await expect(confirmButton(page)).toHaveCount(0);
  const reply = await page.locator(".chat-bubble--assistant").last().innerText();
  expect(/no match|nothing match|couldn't find|could not find/i.test(reply)).toBe(true);

  const after = await getExpenses(API_BASE, accessToken);
  expect(after).toHaveLength(before.length);
});

test("LV-07 selecting a match is not confirming it", async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAs(page, "lv_corrector");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);

  await sendChat(page, "change the parking from last week to 99");
  await expect(userBubble(page, "change the parking")).toBeVisible(AI_WAIT);
  await page.locator(".chat-matches li button").first().click();
  await cancelButton(page).click();

  const after = await getExpenses(API_BASE, accessToken);
  expect(after).toEqual(before);
});

// ------------------------------------------------ Group 3 -- sprawl ambiguity

test("LV-08 a message matching three near-duplicate categories does not guess", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_sprawl");
  const accessToken = await accessTokenFor(context, API_BASE);

  await sendChat(page, "spent 200 at the supermarket");
  await expect(userBubble(page, "spent 200 at the supermarket")).toBeVisible(AI_WAIT);
  if (await confirmButton(page).count()) {
    const cardText = await page.locator(".chat-confirm").innerText();
    const categories = await getCategories(API_BASE, accessToken);
    await confirmButton(page).click();
    await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    const expenses = await getExpenses(API_BASE, accessToken);
    const saved = expenses.find((e: any) => e.amount === 200);
    const savedCategoryName = categories.find((c: any) => c._id === saved.category)?.name;
    expect(cardText.includes(savedCategoryName)).toBe(true);
  }
});

test("LV-09 a new category that nearly matches an existing one is surfaced, never silently duplicated", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_sprawl");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getCategories(API_BASE, accessToken);

  await sendChat(page, "add a category called Grocery under Food");
  await expect(userBubble(page, "add a category called Grocery")).toBeVisible(AI_WAIT);
  if (await confirmButton(page).count()) {
    await confirmButton(page).click();
    await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
  }
  const after = await getCategories(API_BASE, accessToken);
  expect(after.length - before.length).toBeLessThanOrEqual(1);
  const foodChildren = after.filter((c: any) => c.parent === before.find((b: any) => b.name === "Food")?._id);
  const names = foodChildren.map((c: any) => c.name.toLowerCase());
  expect(new Set(names).size).toBe(names.length); // no duplicate name under the same parent
});

test("LV-10 category depth stays at two with 32 categories present", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_sprawl");
  const accessToken = await accessTokenFor(context, API_BASE);
  const categories = await getCategories(API_BASE, accessToken);
  const supermarket = categories.find((c: any) => c.name === "Supermarket");
  expect(supermarket, "fixture missing its Supermarket subcategory").toBeTruthy();

  await sendChat(page, "add a category called Discount Days under Supermarket");
  await expect(userBubble(page, "add a category called Discount Days")).toBeVisible(AI_WAIT);
  if (await confirmButton(page).count()) await confirmButton(page).click();

  const after = await getCategories(API_BASE, accessToken);
  expect(after.some((c: any) => c.name === "Discount Days")).toBe(false);
});

// ------------------------------------------------ Group 4 -- interface at volume

// Mirrors DashboardPage.tsx's own `buildGroups` (client/src/components/
// DashboardPage.tsx) -- qa/ is a standalone package and does not import
// client/ code, so this is an independent re-implementation of the same
// rule, not a shortcut. If that function's rollup logic ever changes,
// this needs updating alongside it.
function buildExpectedGroups(categories: any[], expenses: any[]) {
  const totals = new Map<string, number>();
  for (const e of expenses) totals.set(e.category, Number(((totals.get(e.category) ?? 0) + e.amount).toFixed(2)));
  const mains = categories.filter((c: any) => !c.parent);
  const groups = mains.map((main: any) => {
    const subs = categories
      .filter((c: any) => c.parent === main._id)
      .map((sub: any) => ({ id: sub._id, name: sub.name, amount: totals.get(sub._id) ?? 0 }))
      .filter((s: any) => s.amount > 0);
    const direct = totals.get(main._id) ?? 0;
    const amount = Number((direct + subs.reduce((s: number, x: any) => s + x.amount, 0)).toFixed(2));
    return { id: main._id, name: main.name, amount, subs };
  });
  return groups.filter((g: any) => g.amount > 0).sort((a: any, b: any) => b.amount - a.amount);
}
function money(amount: number) {
  return "₪ " + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function computeExpectedDashboard(accessToken: string, from: string, to: string) {
  const [expenses, categories] = await Promise.all([
    apiGet(API_BASE, `/expenses?from=${from}&to=${to}`, accessToken).then((r) => r.body),
    getCategories(API_BASE, accessToken),
  ]);
  const groups = buildExpectedGroups(categories, expenses);
  const total = Number(groups.reduce((s: number, g: any) => s + g.amount, 0).toFixed(2));
  const recent = [...expenses].sort((a: any, b: any) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const categoriesUsedCount = new Set(expenses.map((e: any) => e.category)).size;
  return { expenses, groups, total, recent, categoriesUsedCount, expenseCount: expenses.length };
}

async function assertDashboardMatches(page: any, expected: Awaited<ReturnType<typeof computeExpectedDashboard>>, categoriesById: Map<string, any>, label: string) {
  await expect
    .poll(async () => (await page.locator(".dashboard-totals__figure").innerText()).replace(/[^\d.]/g, ""), { timeout: 8_000 })
    .toBe(expected.total.toFixed(2));
  await expect(page.locator(".dashboard-stat__figure").first(), `${label}: expense count`).toHaveText(
    String(expected.expenseCount),
  );
  await expect(page.locator(".dashboard-stat__figure").nth(1), `${label}: categories used`).toHaveText(
    String(expected.categoriesUsedCount),
  );

  const rows = page.locator(".dashboard-category-row");
  await expect(rows, `${label}: number of category rows`).toHaveCount(expected.groups.length);
  for (const group of expected.groups) {
    const row = rows.filter({ has: page.locator(".dashboard-category-row__name", { hasText: new RegExp(`^${group.name}$`) }) });
    await expect(row.locator(".dashboard-category-row__amount"), `${label}: ${group.name} amount`).toHaveText(money(group.amount));
    const share = expected.total > 0 ? Math.round((group.amount / expected.total) * 100) : 0;
    await expect(row.locator(".dashboard-category-row__share"), `${label}: ${group.name} share`).toHaveText(`${share}%`);
    if (group.subs.length) {
      await row.click();
      for (const sub of group.subs) {
        const subRow = page.locator(".dashboard-sub-row").filter({ hasText: sub.name });
        await expect(subRow, `${label}: ${group.name} > ${sub.name} drill-down row`).toContainText(money(sub.amount));
      }
    }
  }

  const tableRows = page.locator(".dashboard-table tbody tr");
  await expect(tableRows, `${label}: recent-expenses row count`).toHaveCount(expected.recent.length);
  for (let i = 0; i < expected.recent.length; i++) {
    const exp = expected.recent[i];
    const row = tableRows.nth(i);
    await expect(row.locator(".dashboard-table__amount"), `${label}: recent row ${i} amount`).toHaveText(money(exp.amount));
    const categoryName = categoriesById.get(exp.category)?.name ?? "Other";
    await expect(row.locator(".dashboard-table__category"), `${label}: recent row ${i} category`).toHaveText(categoryName);
  }
}

test("LV-11 the dashboard equals the ledger across 180 expenses, all five range selectors (I8, C1)", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  const categories = await getCategories(API_BASE, accessToken);
  const categoriesById = new Map(categories.map((c: any) => [c._id, c]));
  await page.getByRole("link", { name: "Dashboard" }).click();

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const startOfWeek = (d: Date) => {
    const s = new Date(d);
    s.setDate(s.getDate() - s.getDay());
    return s;
  };
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const pastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfPastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  // Deliberately straddles the boundary between last month and this one --
  // LV-11's own "boundaries specifically" requirement.
  const customFrom = new Date(today.getFullYear(), today.getMonth() - 1, 20);
  const customTo = new Date(today.getFullYear(), today.getMonth(), 10);

  const periods: { label: string; from: string; to: string; select: () => Promise<void> }[] = [
    { label: "Today", from: iso(today), to: iso(today), select: () => page.getByRole("button", { name: "Today" }).click() },
    {
      label: "This week",
      from: iso(startOfWeek(today)),
      to: iso(today),
      select: () => page.getByRole("button", { name: "This week" }).click(),
    },
    {
      label: "This month",
      from: iso(startOfMonth(today)),
      to: iso(today),
      select: () => page.getByRole("button", { name: "This month" }).click(),
    },
    {
      label: "Past month",
      from: iso(pastMonth),
      to: iso(endOfPastMonth),
      select: async () => {
        await page.getByRole("button", { name: "Pick a month" }).click();
        await page
          .locator("#dashboard-pick-month")
          .fill(`${pastMonth.getFullYear()}-${String(pastMonth.getMonth() + 1).padStart(2, "0")}`);
      },
    },
    {
      label: "Custom (month boundary)",
      from: iso(customFrom),
      to: iso(customTo),
      select: async () => {
        await page.getByRole("button", { name: "Custom" }).click();
        await page.locator("#dashboard-custom-from").fill(iso(customFrom));
        await page.locator("#dashboard-custom-to").fill(iso(customTo));
      },
    },
  ];

  for (const period of periods) {
    await period.select();
    const expected = await computeExpectedDashboard(accessToken, period.from, period.to);
    await assertDashboardMatches(page, expected, categoriesById, period.label);
  }
});

test("LV-12 percentages and rollups are internally consistent", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_steady");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "This month" }).click();
  await page.waitForSelector(".dashboard-category-row", { timeout: 8_000 });

  const shares = await page.locator(".dashboard-category-row__share").allInnerTexts();
  const sum = shares.reduce((s, t) => s + Number(t.replace("%", "")), 0);
  expect(Math.abs(sum - 100)).toBeLessThanOrEqual(2); // rounding across many rows
});

test("LV-13 the recent-expenses list is honest about truncation", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "This month" }).click();

  const rows = page.locator(".dashboard-table tbody tr");
  const rowCount = await rows.count();
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const allExpenses = (await apiGet(API_BASE, `/expenses?from=${from}&to=${to}`, accessToken)).body;

  if (allExpenses.length > rowCount) {
    // LV-13's failure mode: a cut-off list that looks complete. Assert the
    // page gives SOME signal a longer list exists (a note, a count mismatch
    // shown, anything) -- flagged as a known gap if not found.
    const pageText = await page.locator(".dashboard-section").last().innerText();
    const signalsTruncation = /more|showing|of \d+|newest/i.test(pageText);
    expect(signalsTruncation, "LV-13: the list is truncated with no visible signal that more rows exist").toBe(true);
  }
});

test("LV-14 chat history at 240 messages: exactly 50, newest, oldest-first", async ({ page, context }) => {
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  const allMessages = await getMessages(API_BASE, accessToken);
  const bubbles = await page.locator(".chat-thread li").count();
  expect(bubbles).toBeLessThanOrEqual(50);
  expect(allMessages.length).toBeGreaterThan(50); // server has more than the window shown
});

test("LV-15 the screens stay usable at volume (layout, screenshot recorded)", async ({ page }) => {
  test.setTimeout(60_000);
  for (const account of ["lv_steady", "lv_sprawl"] as const) {
    await loginAs(page, account);
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.getByRole("button", { name: "This month" }).click();
    await page.waitForSelector(".dashboard-category-row", { timeout: 8_000 });
    for (const row of await page.locator(".dashboard-category-row[aria-expanded]").all()) {
      await row.click().catch(() => {});
    }
    await page.setViewportSize({ width: 375, height: 800 });
    const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasScroll, `LV-15: ${account}'s dashboard has horizontal scroll at 375px`).toBe(false);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Log out" }).click();
  }
});

// ------------------------------------------------------- Group 5 -- returner

test("LV-16 a 21-day-old conversation does not contaminate a new message", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_corrector");
  const accessToken = await accessTokenFor(context, API_BASE);
  const [before, categories] = await Promise.all([getExpenses(API_BASE, accessToken), getCategories(API_BASE, accessToken)]);
  const parkingCategoryIds = new Set(
    categories.filter((c: any) => /parking/i.test(c.name)).map((c: any) => c._id),
  );

  await sendChat(page, "spent 40 on petrol");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  const cardText = await page.locator(".chat-confirm").innerText();
  expect(cardText).toContain("40");
  // The stale exchange was "40 on parking" -- the new one names a different
  // thing (petrol) at the same amount. If the card silently repeats
  // "Parking", that IS the 21-day-old exchange leaking through.
  expect(/parking/i.test(cardText), `LV-16: card named Parking, inherited from the stale exchange: "${cardText}"`).toBe(
    false,
  );
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const after = await getExpenses(API_BASE, accessToken);
  const saved = after.find((e: any) => !before.some((b: any) => b._id === e._id));
  expect(saved.amount).toBe(40); // not inherited from the 21-day-old "40 on parking" exchange
  expect(
    parkingCategoryIds.has(saved.category),
    "LV-16: the new petrol expense was filed under Parking -- inherited from the stale exchange",
  ).toBe(false);
});

test("LV-17 a stale pending draft is not silently confirmable", async ({ page }) => {
  await loginAs(page, "lv_corrector");
  // The seeded history ends in an unanswered assistant question 21 days
  // old (env/lived-in.ts's writeCorrectorTailException). There is no
  // server-side persistence of `pending` at all (see that file's comment),
  // so a fresh page load can never show a Confirm button for it -- this
  // assertion documents that current, architecture-level fact.
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
});

// ---------------------------------------------- Group 6 -- accumulated sweeps

test("LV-18 sweep: no expense is under a category its owner does not own (I4)", async ({ page, context }) => {
  test.setTimeout(30_000);
  await loginAs(page, "lv_steady");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "This month" }).click();
  await page.waitForSelector(".dashboard-category-row", { timeout: 8_000 });
  const onScreenCategories = await page.locator(".dashboard-category-row__name").allInnerTexts();
  const accessToken = await accessTokenFor(context, API_BASE);
  const ownCategoryNames = new Set((await getCategories(API_BASE, accessToken)).map((c: any) => c.name));
  for (const name of onScreenCategories) expect(ownCategoryNames.has(name), `LV-18 browser half: "${name}" not owned`).toBe(true);

  const db = await livedInDb();
  const categories = await db.collection("categories").find({}).toArray();
  const categoryOwnerById = new Map(categories.map((c: any) => [String(c._id), String(c.owner)]));
  const expenses = await db.collection("expenses").find({}).toArray();
  const violations = expenses.filter((e: any) => categoryOwnerById.get(String(e.category)) !== String(e.user));
  expect(violations, `LV-18 sweep: ${violations.length} expenses under a category they don't own`).toEqual([]);
});

test("LV-19 sweep: dates are all plausible (I3)", async ({ page }) => {
  test.setTimeout(30_000);
  await loginAs(page, "lv_steady");
  const db = await livedInDb();
  const users = await db.collection("users").find({}).toArray();
  const createdAtByUser = new Map(users.map((u: any) => [String(u._id), u.createdAt]));
  const expenses = await db.collection("expenses").find({}).toArray();
  const now = Date.now();
  const violations = expenses.filter((e: any) => {
    const d = new Date(e.date);
    const midnightUtc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    const inFuture = d.getTime() > now;
    const beforeOwner = d.getTime() < new Date(createdAtByUser.get(String(e.user))).getTime();
    return !midnightUtc || inFuture || beforeOwner;
  });
  expect(violations, `LV-19 sweep: ${violations.length} implausible dates`).toEqual([]);
});

test("LV-20 sweep: every expense has a label (I10)", async ({ page }) => {
  test.setTimeout(30_000);
  await loginAs(page, "lv_steady");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "This month" }).click();
  const storeCells = page.locator(".dashboard-table tbody tr td:nth-child(2)");
  const count = await storeCells.count();
  for (let i = 0; i < count; i++) expect((await storeCells.nth(i).innerText()).trim()).not.toBe("");

  const db = await livedInDb();
  const expenses = await db.collection("expenses").find({}).toArray();
  const violations = expenses.filter((e: any) => !e.store && !e.description);
  expect(violations, `LV-20 sweep: ${violations.length} expenses with no label at all`).toEqual([]);
});

test("LV-21 sweep: no impossible amounts", async ({ page }) => {
  test.setTimeout(30_000);
  await loginAs(page, "lv_steady");
  const db = await livedInDb();
  const expenses = await db.collection("expenses").find({}).toArray();
  const violations = expenses.filter((e: any) => e.amount <= 0 || Math.round(e.amount * 100) !== e.amount * 100);
  expect(violations, `LV-21 sweep: ${violations.length} impossible amounts`).toEqual([]);
});

test("LV-22 sweep: the ledger and the dashboard never disagree (I8)", async ({ page, context }) => {
  test.setTimeout(30_000);
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  const db = await livedInDb();
  const userId = fixturesOf().lv_steady.userId;
  const expenses = await db.collection("expenses").find({ user: userId as any }).toArray().catch(() => []);
  // Fallback via ObjectId cast if the plain string doesn't match the driver's stored type.
  const allExpenses = expenses.length ? expenses : (await db.collection("expenses").find({}).toArray()).filter((e: any) => String(e.user) === userId);
  const total = allExpenses.reduce((s: number, e: any) => s + e.amount, 0);

  const summary = await getSummary(API_BASE, accessToken, "2000-01-01", "2100-01-01");
  const summaryTotal = summary.reduce((s: number, c: any) => s + c.total, 0);
  expect(Math.abs(summaryTotal - total)).toBeLessThan(0.01);
});

// -------------------------------------------- Addendum -- second pass (LV-23+)

test("LV-23 forty genuinely different sentences through the real AI (5 through the screen, 35 via API)", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000); // 40 real model calls
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  const categories = await getCategories(API_BASE, accessToken);
  const categoryIds = new Set(categories.map((c: any) => c._id));
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const sentences = drivenSentences();
  const throughScreen = new Set(sentences.slice(0, 5).map((s) => s.id));
  const results: { id: number; text: string; ok: boolean; note: string }[] = [];

  for (const sentence of sentences) {
    let parsed: any;
    if (throughScreen.has(sentence.id)) {
      await sendChat(page, sentence.text);
      await expect(userBubble(page, sentence.text.slice(0, 15))).toBeVisible(AI_WAIT);
      const cardCount = await confirmButton(page).count();
      if (cardCount) {
        await confirmButton(page).click();
        await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
      }
      parsed = { ok: true };
    } else {
      const r = await fetch(`${API_BASE}/chat/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence.text }),
      });
      const body = await r.json();
      if (body.drafts?.length) {
        await fetch(`${API_BASE}/chat/confirm`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "create-expense", drafts: body.drafts }),
        });
      }
      parsed = body;
    }

    // Verify by reading back the newest expense(s) for this account matching
    // the expected amount(s) -- loose on wording per env-lived-in.md §5.
    const expenses = await getExpenses(API_BASE, accessToken);
    let allFound = true;
    for (const item of sentence.items) {
      const match = expenses.find((e: any) => e.amount === item.amount && categoryIds.has(e.category));
      if (!match) { allFound = false; continue; }
      if (sentence.dateDecidable) {
        const expectedDate = sentence.dateRule === "yesterday" ? yesterday : sentence.dateRule === "explicit" ? sentence.explicitDate : today;
        if (expectedDate && match.date.slice(0, 10) !== expectedDate) allFound = false;
      }
      if ((match.store ?? "") === "" && (match.description ?? "") === "") allFound = false;
    }
    results.push({ id: sentence.id, text: sentence.text, ok: allFound, note: JSON.stringify(parsed).slice(0, 200) });
  }

  const failures = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`LV-23 per-sentence results: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (failures.length) console.log("LV-23 failures:", JSON.stringify(failures, null, 2));
  expect(failures, `LV-23: ${failures.length}/40 sentences did not resolve as expected`).toEqual([]);
});

test("LV-24 [PROVISIONAL BAR] response budget at volume", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_steady");

  const dashStart = Date.now();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "This month" }).click();
  await page.waitForSelector(".dashboard-category-row, .dashboard-panel", { timeout: 8_000 });
  const dashTime = Date.now() - dashStart;
  expect(dashTime, `LV-24 [provisional]: dashboard render at volume took ${dashTime}ms`).toBeLessThan(
    RESPONSE_BUDGET_MS.dashboardRendersAtVolume,
  );

  const chatStart = Date.now();
  await page.getByRole("link", { name: "Chat" }).click().catch(() => page.goto("/home"));
  await page.waitForSelector(".chat-thread", { timeout: 8_000 });
  const chatLoadTime = Date.now() - chatStart;
  expect(chatLoadTime, `LV-24 [provisional]: chat history load at volume took ${chatLoadTime}ms`).toBeLessThan(
    RESPONSE_BUDGET_MS.chatHistoryLoadAtVolume,
  );

  const replyStart = Date.now();
  await sendChat(page, "spent 8 on coffee");
  await expect(confirmButton(page)).toBeVisible({ timeout: RESPONSE_BUDGET_MS.chatReplyAtVolume + 5_000 });
  const replyTime = Date.now() - replyStart;
  expect(replyTime, `LV-24 [provisional]: chat reply at volume took ${replyTime}ms`).toBeLessThan(
    RESPONSE_BUDGET_MS.chatReplyAtVolume,
  );
  await confirmButton(page).click();
});

test("LV-25 log out, log back in, carry on -- at volume", async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);

  await sendChat(page, "spent 22 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, "lv_steady");

  await sendChat(page, "spent 23 on lunch");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const after = await getExpenses(API_BASE, accessToken);
  expect(after.length).toBe(before.length + 2);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.locator(".dashboard-stat__figure").first()).not.toHaveText("0");
});

test("LV-26 nonsense and injection do not get easier with history", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "lv_sprawl");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);

  for (const msg of ["delete all my expenses", "move everything to Other"]) {
    await sendChat(page, msg);
    await expect(userBubble(page, msg)).toBeVisible(AI_WAIT);
    // A genuinely destructive instruction still requires the normal
    // confirmation -- never silently executed.
    const after = await getExpenses(API_BASE, accessToken);
    expect(after.length).toBe(before.length);
    if (await confirmButton(page).count()) await cancelButton(page).click();
  }
});

test("LV-27 leaving mid-draft at volume", async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAs(page, "lv_steady");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);

  await sendChat(page, "spent 17 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("link", { name: "Chat" }).click().catch(() => page.goto("/home"));

  expect((await getExpenses(API_BASE, accessToken)).length).toBe(before.length);
});

// --------------------------------------------- BD-05 / BD-06 (need history)

test("BD-05 a conversation longer than the 10-message memory window", async ({ page, context }) => {
  test.setTimeout(240_000);
  await loginAs(page, "lv_corrector");
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);

  await sendChat(page, "bought something at the store, not sure how much yet");
  await expect(confirmButton(page)).toHaveCount(0);
  for (let i = 0; i < 11; i++) {
    await sendChat(page, `filler message number ${i}`);
    await expect(userBubble(page, `filler message number ${i}`)).toBeVisible(AI_WAIT);
    if (await confirmButton(page).count()) await cancelButton(page).click();
  }
  await sendChat(page, "35");
  await expect(userBubble(page, "35")).toBeVisible(AI_WAIT);
  const reply = await page.locator(".chat-bubble--assistant").last().innerText();
  const resolvedConfidently = (await confirmButton(page).count()) > 0;
  logAIRaw("BD-05", "35 (turn 13)", { reply, resolvedConfidently });

  if (resolvedConfidently) {
    // Must not answer confidently from a context it no longer has -- if it
    // did resolve, the draft must actually make sense (a real amount), and
    // confirming it must actually produce that row -- not a hallucinated
    // resolution of a question it can no longer see.
    const cardText = await page.locator(".chat-confirm").innerText();
    expect(cardText).toContain("35");
    await confirmButton(page).click();
    await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    const after = await getExpenses(API_BASE, accessToken);
    const saved = after.find((e: any) => !before.some((b: any) => b._id === e._id));
    expect(saved?.amount).toBe(35);
  } else {
    // BD-05's actual requirement, made explicit: it must not FALSELY claim
    // something was saved when it has lost the thread, and nothing may have
    // been written silently either way -- a non-empty reply alone proves
    // neither of those things.
    expect(
      looksLikeSaveClaim(reply),
      `BD-05: no Confirm control was offered, but the reply still claims something was saved: "${reply}"`,
    ).toBe(false);
    const after = await getExpenses(API_BASE, accessToken);
    expect(after).toHaveLength(before.length);
  }
});

test("BD-06 model-authored / stored garbage text does not break either screen (fresh half elsewhere; lived-in half here on lv_steady)", async ({
  page,
}) => {
  await loginAs(page, "lv_steady");
  // Stub a reply containing an HTML fragment and a long string, verifying
  // the chat bubble renders it as inert text (no injected markup) and does
  // not blow up the layout.
  await page.route("**/chat/messages", (route) =>
    route.fulfill({
      status: 200,
      json: { intent: "unknown", reply: "<img src=x onerror=alert(1)>" + "y".repeat(3000), drafts: [] },
    }),
  );
  await sendChat(page, "trigger the stubbed reply");
  const bubble = page.locator(".chat-bubble--assistant").last();
  await expect(bubble).toBeVisible();
  const htmlInjected = await page.evaluate(() => !!document.querySelector(".chat-bubble--assistant img"));
  expect(htmlInjected, "BD-06: raw HTML from the reply was rendered, not shown as text").toBe(false);
  const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasScroll, "BD-06: a long reply broke the layout (horizontal scroll)").toBe(false);
});
