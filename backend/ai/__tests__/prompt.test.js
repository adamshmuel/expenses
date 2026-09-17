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
