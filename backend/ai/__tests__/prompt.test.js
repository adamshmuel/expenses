const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPrompt } = require("../prompt");

const categories = [{ name: "Food", parent: null }];
const recentExpenses = [];

test("buildPrompt with no history omits the conversation section without crashing", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.equal(typeof prompt, "string");
  assert.ok(!prompt.includes("undefined"));
});

test("buildPrompt with an empty history array degrades the same as no history", () => {
  const prompt = buildPrompt(categories, recentExpenses, []);
  assert.equal(typeof prompt, "string");
  assert.ok(!prompt.includes("undefined"));
});

test("buildPrompt renders each history message with a distinguishable role", () => {
  const history = [
    { role: "assistant", text: "I see you paid 50, but what category does this belong to?" },
    { role: "user", text: "bike" },
  ];

  const prompt = buildPrompt(categories, recentExpenses, history);

  assert.ok(prompt.includes("what category does this belong to?"));
  assert.ok(prompt.includes("assistant"));
  assert.ok(prompt.includes("user"));
});

test("buildPrompt marks the last history entry as the current message, not a prior turn", () => {
  const history = [
    { role: "assistant", text: "what category does this belong to?" },
    { role: "user", text: "bike" },
  ];

  const prompt = buildPrompt(categories, recentExpenses, history);

  // The current message ("bike") must be marked distinctly from earlier turns
  // so the model does not read it as a second, separate prior turn.
  const lines = prompt.split("\n");
  const bikeLine = lines.find((line) => line.includes("bike"));
  const priorQuestionLine = lines.find((line) => line.includes("what category does this belong to?"));

  assert.ok(bikeLine, "current message should appear in the prompt");
  assert.notEqual(bikeLine, priorQuestionLine);
  assert.notEqual(bikeLine, undefined);
  assert.ok(/current/i.test(bikeLine));
});

test("buildPrompt states the caller-supplied today's date as YYYY-MM-DD (bug A: model must not guess)", () => {
  const prompt = buildPrompt(categories, recentExpenses, [], "2026-09-16");
  assert.ok(prompt.includes("2026-09-16"));
});

test("buildPrompt accepts a Date object for today and renders it as YYYY-MM-DD", () => {
  const prompt = buildPrompt(categories, recentExpenses, [], new Date("2026-09-16T12:00:00Z"));
  assert.ok(prompt.includes("2026-09-16"));
});

test("buildPrompt with no today argument still produces a string without crashing", () => {
  const prompt = buildPrompt(categories, recentExpenses, []);
  assert.equal(typeof prompt, "string");
  assert.ok(!prompt.includes("undefined"));
});

test("buildPrompt tells the model never to turn a negative amount into a positive one (bug 3a)", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.match(prompt, /negative/i);
  assert.match(prompt, /minus sign/i);
});

test("buildPrompt tells the model amounts stop at two decimal places, the agora (bug 3b)", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.match(prompt, /agora/i);
  assert.match(prompt, /two decimal places/i);
});

// --- 2026-09-17 QA run: bug 1 — the model narrated a save that never happened ---

test("buildPrompt forbids claiming a save happened, in any tense", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  // The old rule only forbade the model from *deciding* something was saved,
  // which a past-tense reply ("I have saved your expense") slips past. The
  // rule must explicitly rule out describing a save as already done.
  assert.ok(/past tense/i.test(prompt), "must call out past-tense phrasing specifically");
  assert.ok(/never happened|has not happened|not yet happened|nothing has been saved/i.test(prompt));
});

test("buildPrompt tells the model free-text \"yes\" is not a confirmation it can act on", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(/"yes"/i.test(prompt), "must mention the literal word yes as an example");
  assert.ok(/confirm button|Confirm button/.test(prompt), "must point the user at the UI's Confirm button");
});

// --- 2026-09-17 QA run: bug 2 — a correction was acknowledged in prose but dropped from the payload ---

test("buildPrompt makes the structured fields, not the reply, the binding source of a correction", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(
    /reply describes what (the fields|drafts|changes) (say|contain)|reply must describe the (fields|drafts|changes)/i.test(prompt),
    "must state the reply is derived from the fields, not the other way round"
  );
});

// --- 2026-09-17 QA run: bug 5 — the model leaked its own deliberation into "store" ---

test("buildPrompt gives an unambiguous rule for store vs description", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(/"store"/.test(prompt) && /"description"/.test(prompt));
  // Must be phrased as a deterministic rule ("if X, use store; otherwise use
  // description"), not left for the model to weigh — that ambiguity is what
  // produced visible self-argument in the field in production.
  assert.ok(/where the money was spent|who was paid|the business|the merchant/i.test(prompt));
});

test("buildPrompt states free-text fields carry only the final value, never reasoning", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(/never\s+(include|write|put)\s+(your\s+)?reasoning|no reasoning|not your reasoning/i.test(prompt));
});

test("buildPrompt states the 200 character cap on free-text fields explicitly", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(/200 characters/.test(prompt));
});

// --- 2026-09-17 QA run: bug 8 — offered to act on an expense that does not exist ---

test("buildPrompt tells the model an edit/delete reply must not presuppose a match exists", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(
    /does not (search|query|look up)|cannot know (whether|if) a match|has not been (found|searched)/i.test(prompt),
    "must explain the model has no way to know if a match exists yet"
  );
  assert.ok(/if (a |one )?match is found|if it exists|conditional/i.test(prompt));
});

// --- 2026-09-17 QA run: FR-43 — a Hebrew message got an English reply ---

test("buildPrompt tells the model to reply in the same language the user wrote in", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(
    /"reply".{0,80}same language|same language.{0,80}"reply"|reply in the (same |user's own )?language/i.test(prompt),
    "must state the reply is written in the language the user used"
  );
});

// --- 2026-09-17 QA run: bug — "gas" (a thing bought, no place) landed in
// "description" as the rule intends, but the STORE column then displays it
// because "store" was never filled; the ambiguous "cannot tell which it is"
// judgment call is also what made the model visibly deliberate in production. ---

test("buildPrompt tells the model to leave \"store\" empty when the text names only a thing bought, not a place", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(
    /names? only a thing[^.]*(leave "store" out|store.{0,20}(stays|left)\s+empty)/is.test(prompt) ||
      /(leave "store" out|store.{0,20}(stays|left)\s+empty)[^.]*names? only a thing/is.test(prompt),
    'must say "store" is left empty specifically for the only-a-thing case, not filled with the thing bought'
  );
});

test("buildPrompt replaces the ambiguous \"cannot tell which it is\" judgment call with a deterministic place-vs-thing rule", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(
    !/cannot tell which/i.test(prompt),
    "the old ambiguous rule (decide whether you can tell, then guess) must be gone"
  );
  assert.ok(/names?\s+a\s+place/i.test(prompt) && /names?\s+a\s+thing/i.test(prompt));
});

// --- 2026-09-17 QA run: regression — dropping the old "if you can't tell
// which, use description" catch-all left text that is neither clearly a
// place nor clearly a thing (e.g. "the place near work") with nowhere to
// land, so the model filled neither field and asked a question instead of
// drafting. The place-vs-thing rule must cover every input, not just the
// two clear cases. ---

test('buildPrompt gives a fallback so text that is neither a clear place nor a clear thing still lands in "description"', () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(
    /neither\s+(a\s+)?(clear\s+)?place\s+nor\s+(a\s+)?(clear\s+)?thing[^.]{0,200}"description"/is.test(prompt) ||
      /"description"[^.]{0,200}neither\s+(a\s+)?(clear\s+)?place\s+nor\s+(a\s+)?(clear\s+)?thing/is.test(prompt),
    'must state a deterministic fallback: text that names neither a place nor a thing still goes in "description", so no input is left with both fields empty'
  );
});

test('buildPrompt never lets a create-expense draft leave both "store" and "description" empty', () => {
  const prompt = buildPrompt(categories, recentExpenses);
  assert.ok(
    /never\s+leave\s+both\s+"store"\s+and\s+"description"\s+empty/i.test(prompt),
    'must explicitly forbid leaving both fields empty, not just describe the two clear cases'
  );
});

// --- 2026-09-17 QA run: FR-42 — told the app can't total spending, never told the dashboard can ---

test("buildPrompt points an unanswerable totals/spending question at the dashboard", () => {
  const prompt = buildPrompt(categories, recentExpenses);
  // The refusal and the dashboard pointer must be the same instruction — the
  // negation words alone appear all over the prompt, so assert them together.
  assert.ok(
    /(can't|cannot|can not|does not|doesn't)[^.]{0,200}dashboard/i.test(prompt),
    "must tell the model to refuse the totals question AND point at the dashboard"
  );
});
