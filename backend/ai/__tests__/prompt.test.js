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
