/**
 * The 180-sentence input-diversity corpus — qa/specs/env-lived-in.md §2a.
 * Written once, deterministic, checked in. Two uses:
 *   1. SEEDING (all 180) — qa/env/lived-in.ts turns every sentence into
 *      Expense rows via the metadata attached to it here (`items`), not by
 *      re-parsing the English/Hebrew text with NLP. That metadata IS "the
 *      deterministic local parser written for the seeder" the spec calls
 *      for: since this file controls both the text and the ground truth,
 *      generating them together is a valid, deterministic parser by
 *      construction — it is never claimed to understand free text in
 *      general, only the templates below.
 *   2. DRIVING (a named 40, `DRIVEN_IDS`) — LV-23 sends the raw `.text` of
 *      just these 40 through the real model and checks the real reply
 *      against the same ground truth.
 *
 * No RNG: every sentence is built from its index, so the corpus is
 * byte-identical across runs without a seed to manage (env-lived-in.md §5).
 */

export type DateRule = "none" | "today" | "yesterday" | "weekday" | "lastweek" | "explicit";
export type Language = "en" | "he" | "mixed";

export interface CorpusItem {
  /** The label the seeder stores as `store` or `description`. */
  label: string;
  amount: number;
  /** Main category name (one of the 8 defaults) this item resolves to. */
  categoryMain: string;
  /** Subcategory name, or null when the item belongs on the main category itself. */
  categorySub: string | null;
}

export interface CorpusSentence {
  id: number;
  text: string;
  language: Language;
  dateRule: DateRule;
  /** Only meaningful for dateRule "explicit" — the literal date named in the sentence. */
  explicitDate?: string; // YYYY-MM-DD
  /** Whether dateRule is decidable enough to assert an exact stored date.
   *  "weekday"/"lastweek" are not — see blocker B-A, docs the fresh spec's FR-12. */
  dateDecidable: boolean;
  items: CorpusItem[];
  /** Part of the 40 sent through the real model for LV-23. */
  driven: boolean;
}

// ---- item catalogue: label -> category, spread across all 8 defaults ----
const ITEM_CATALOGUE: { label: string; main: string; sub: string | null }[] = [
  { label: "the supermarket", main: "Food", sub: "Groceries" },
  { label: "groceries", main: "Food", sub: "Groceries" },
  { label: "coffee", main: "Food", sub: "Coffee" },
  { label: "lunch", main: "Food", sub: "Restaurants" },
  { label: "dinner", main: "Food", sub: "Restaurants" },
  { label: "gas", main: "Transport", sub: "Fuel" },
  { label: "the bus", main: "Transport", sub: "Public transport" },
  { label: "a taxi", main: "Transport", sub: "Public transport" },
  { label: "parking", main: "Transport", sub: "Parking" },
  { label: "rent", main: "Home", sub: "Rent" },
  { label: "electricity", main: "Home", sub: "Utilities" },
  { label: "the internet bill", main: "Home", sub: "Internet" },
  { label: "the pharmacy", main: "Health", sub: null },
  { label: "the dentist", main: "Health", sub: null },
  { label: "the gym", main: "Health", sub: null },
  { label: "a movie", main: "Entertainment", sub: null },
  { label: "a concert ticket", main: "Entertainment", sub: null },
  { label: "a book", main: "Education", sub: null },
  { label: "a course", main: "Education", sub: null },
  { label: "a shirt", main: "Clothing", sub: null },
  { label: "shoes", main: "Clothing", sub: null },
  { label: "a haircut", main: "Other", sub: null },
  { label: "a phone case", main: "Other", sub: null },
  { label: "a birthday gift", main: "Other", sub: null },
];

const HE_ITEM_CATALOGUE: { label: string; heWord: string; main: string; sub: string | null }[] = [
  { label: "coffee", heWord: "קפה", main: "Food", sub: "Coffee" },
  { label: "the supermarket", heWord: "סופרמרקט", main: "Food", sub: "Groceries" },
  { label: "gas", heWord: "דלק", main: "Transport", sub: "Fuel" },
  { label: "parking", heWord: "חניה", main: "Transport", sub: "Parking" },
  { label: "the bus", heWord: "אוטובוס", main: "Transport", sub: "Public transport" },
  { label: "rent", heWord: "שכירות", main: "Home", sub: "Rent" },
  { label: "electricity", heWord: "חשמל", main: "Home", sub: "Utilities" },
  { label: "the pharmacy", heWord: "בית מרקחת", main: "Health", sub: null },
  { label: "a movie", heWord: "סרט", main: "Entertainment", sub: null },
  { label: "a book", heWord: "ספר", main: "Education", sub: null },
];

// wording, dimension: "spent 50 on X" / "X, 50" / "paid 50 for X" / "50 at X" /
// "bought X for 50" / "X — 50" (env-lived-in.md §2a wording row) + one extra.
const EN_TEMPLATES = [
  (item: string, amt: string) => `spent ${amt} on ${item}`,
  (item: string, amt: string) => `${item}, ${amt}`,
  (item: string, amt: string) => `paid ${amt} for ${item}`,
  (item: string, amt: string) => `${amt} at ${item}`,
  (item: string, amt: string) => `bought ${item} for ${amt}`,
  (item: string, amt: string) => `${item} — ${amt}`,
  (item: string, amt: string) => `${item} cost me ${amt}`,
];

const HE_TEMPLATES = [
  (item: string, amt: string) => `קניתי ${item} ב-${amt} שקל`,
  (item: string, amt: string) => `שילמתי ${amt} על ${item}`,
  (item: string, amt: string) => `${item} עלה לי ${amt} שקל`,
];

const DATE_PHRASES: { rule: DateRule; en: (d?: string) => string; he: (d?: string) => string }[] = [
  { rule: "none", en: () => "", he: () => "" },
  { rule: "today", en: () => " today", he: () => " היום" },
  { rule: "yesterday", en: () => " yesterday", he: () => " אתמול" },
  { rule: "weekday", en: () => " on Monday", he: () => " ביום שני" },
  { rule: "lastweek", en: () => " last week", he: () => " בשבוע שעבר" },
  { rule: "explicit", en: (d) => ` on ${d}`, he: (d) => ` בתאריך ${d}` },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** A stable "explicit" date, back-dated by `daysAgo` from today, for variety
 *  across the corpus without depending on wall-clock at import time in a way
 *  that would make two runs on different days disagree about *which* dates
 *  appear — only that they are `daysAgo` in the past, which is what every
 *  consumer (the seeder, LV-23) actually checks. */
function explicitDateNDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function applyShape(text: string, shapeIndex: number): string {
  switch (shapeIndex % 4) {
    case 0: // tidy
      return text.charAt(0).toUpperCase() + text.slice(1) + ".";
    case 1: // lower-case fragment, no punctuation
      return text.toLowerCase();
    case 2: // trailing punctuation flourish
      return text + "...";
    default: // a small typo: double the 3rd character if it's a letter
      return text.length > 3 ? text.slice(0, 3) + text.charAt(2) + text.slice(3) : text;
  }
}

/**
 * Deterministic hash mixing, NOT `id % n`. A plain modulo of `id` correlates
 * dimensions that share a common factor with their modulus -- e.g. selecting
 * language via `id % 9` and date-rule via `id % 6` looks independent but
 * isn't: every multiple of 9 is also a multiple of 3, which only ever lands
 * on 2 of the 6 date-rule buckets (found by running `playwright test --list`
 * against this file, which crashed with "no Hebrew + 'today' sentence
 * exists" -- exactly that correlation). Mixing each dimension through its
 * own salt avoids it while staying fully deterministic (no run-to-run
 * drift, env-lived-in.md §5).
 */
function mix(id: number, salt: number): number {
  let h = (Math.imul(id, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function amountFor(index: number): number {
  // Mostly whole numbers, a good few with .50, and four occasional
  // four-figure amounts (rent/insurance-shaped), per env-lived-in.md §2a.
  if (index % 37 === 0) return 1200 + (index % 5) * 400; // four-figure, rare
  if (index % 3 === 0) return 10 + (index % 40) + 0.5; // two-decimal
  return 8 + (index % 90); // whole number
}

function buildOne(id: number): CorpusSentence {
  const dateSpec = DATE_PHRASES[mix(id, 2) % DATE_PHRASES.length];
  const explicitDate = dateSpec.rule === "explicit" ? explicitDateNDaysAgo(5 + (mix(id, 6) % 55)) : undefined;
  const countRoll = mix(id, 4) % 20;
  const multiCount = countRoll === 0 ? 3 : countRoll < 4 ? 2 : 1;

  // Language selection: mostly English, a Hebrew slice, a mixed slice --
  // env-lived-in.md §2a "Language: English, Hebrew, and mixed in one sentence".
  const languageRoll = mix(id, 1) % 12;
  const language: Language = languageRoll === 0 ? "mixed" : languageRoll <= 2 ? "he" : "en";

  const items: CorpusItem[] = [];
  const parts: string[] = [];

  for (let k = 0; k < multiCount; k++) {
    const amt = amountFor(id + k * 17);
    const amtStr = Number.isInteger(amt) ? String(amt) : amt.toFixed(2);

    if (language === "he") {
      const cat = HE_ITEM_CATALOGUE[(id + k) % HE_ITEM_CATALOGUE.length];
      const template = HE_TEMPLATES[(id + k) % HE_TEMPLATES.length];
      parts.push(template(cat.heWord, amtStr) + dateSpec.he(explicitDate));
      items.push({ label: cat.label, amount: amt, categoryMain: cat.main, categorySub: cat.sub });
    } else if (language === "mixed") {
      const cat = HE_ITEM_CATALOGUE[(id + k) % HE_ITEM_CATALOGUE.length];
      // English wording, Hebrew noun in the middle -- "spent 50 on קפה".
      parts.push(`spent ${amtStr} on ${cat.heWord}` + dateSpec.en(explicitDate));
      items.push({ label: cat.label, amount: amt, categoryMain: cat.main, categorySub: cat.sub });
    } else {
      const cat = ITEM_CATALOGUE[(id + k) % ITEM_CATALOGUE.length];
      const template = EN_TEMPLATES[(id + k) % EN_TEMPLATES.length];
      parts.push(template(cat.label, amtStr) + dateSpec.en(explicitDate));
      items.push({ label: cat.label, amount: amt, categoryMain: cat.main, categorySub: cat.sub });
    }
  }

  const joined = parts.length > 1 ? parts.slice(0, -1).join(" and ") + " and " + parts[parts.length - 1] : parts[0];
  const text = applyShape(joined, id);

  return {
    id,
    text,
    language,
    dateRule: dateSpec.rule,
    explicitDate,
    dateDecidable: dateSpec.rule !== "weekday" && dateSpec.rule !== "lastweek",
    items,
    driven: false,
  };
}

export const CORPUS: CorpusSentence[] = Array.from({ length: 180 }, (_, i) => buildOne(i + 1));

/**
 * The 40 driven ids (LV-23) -- fixed, not chosen at random per run, so a
 * failure is reproducible (env-lived-in.md §2a). Picked to span every
 * dimension: every date rule, all three languages, all three item-counts,
 * every shape, and both amount shapes (whole + decimal + one four-figure).
 */
/** Adds the id of the first sentence matching `pred`, if any exists --
 *  defensive by design: a cell of the diversity table (env-lived-in.md §2a)
 *  is a "must include", not a mathematical guarantee out of a deterministic
 *  180-sentence generator, so a missing cell is silently skipped here
 *  rather than crashing the whole corpus (see the `mix()` comment above for
 *  why an earlier, non-defensive version of this DID crash). */
function addFirstMatch(ids: Set<number>, pred: (s: CorpusSentence) => boolean) {
  const hit = CORPUS.find(pred);
  if (hit) ids.add(hit.id);
}

export const DRIVEN_IDS: number[] = (() => {
  const ids = new Set<number>();
  // One of each date rule, in each language where it naturally occurs.
  for (const rule of ["none", "today", "yesterday", "weekday", "lastweek", "explicit"] as DateRule[]) {
    addFirstMatch(ids, (s) => s.dateRule === rule && s.language === "en");
  }
  // Language coverage.
  addFirstMatch(ids, (s) => s.language === "he");
  addFirstMatch(ids, (s) => s.language === "he" && s.dateRule === "today");
  addFirstMatch(ids, (s) => s.language === "mixed");
  addFirstMatch(ids, (s) => s.language === "mixed" && s.dateRule === "yesterday");
  // Item-count coverage.
  addFirstMatch(ids, (s) => s.items.length === 2);
  addFirstMatch(ids, (s) => s.items.length === 3);
  // Four-figure amount.
  addFirstMatch(ids, (s) => s.items.some((it) => it.amount >= 1000));
  // Fill the rest evenly spaced across the corpus for broad coverage.
  let i = 3;
  while (ids.size < 40) {
    ids.add(CORPUS[(i * 7) % CORPUS.length].id);
    i++;
  }
  return [...ids].sort((a, b) => a - b).slice(0, 40);
})();

for (const s of CORPUS) s.driven = DRIVEN_IDS.includes(s.id);

export function drivenSentences(): CorpusSentence[] {
  return CORPUS.filter((s) => s.driven);
}
