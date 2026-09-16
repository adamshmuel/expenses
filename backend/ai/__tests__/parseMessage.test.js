const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");

const { parseMessage } = require("../parseMessage");
const logger = require("../../.config/logger");

const categories = [
  { name: "Food", parent: null },
  { name: "Groceries", parent: "Food" },
  { name: "Entertainment", parent: null },
];
const recentExpenses = [
  { store: "IKEA", amount: 150, category: "Home", date: "2026-09-10" },
];

/**
 * A fake Gemini client: `generateContent` resolves with `{ text }`, the same
 * shape the real @google/genai SDK returns, so parseMessage can JSON.parse it
 * the same way regardless of who supplied it.
 */
function fakeClient(responseJson) {
  return {
    models: {
      generateContent: async () => ({ text: JSON.stringify(responseJson) }),
    },
  };
}

test("create-expense: returns drafts with amount, store, date, category", async () => {
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [
      { amount: 50, store: "supermarket", date: "2026-09-15", category: "Groceries" },
    ],
  });

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].amount, 50);
  assert.equal(result.drafts[0].category, "Groceries");
  assert.equal(typeof result.reply, "string");
});

test("edit-expense: returns searchFilters and changes", async () => {
  const client = fakeClient({
    intent: "edit-expense",
    reply: "Moving the IKEA expense to Home — want me to save it?",
    searchFilters: { text: "IKEA" },
    changes: { category: "Home" },
  });

  const result = await parseMessage("move the ikea expense to home", categories, recentExpenses, { client });

  assert.equal(result.intent, "edit-expense");
  assert.equal(result.searchFilters.text, "IKEA");
  assert.equal(result.changes.category, "Home");
});

test("delete-expense: returns searchFilters", async () => {
  const client = fakeClient({
    intent: "delete-expense",
    reply: "Looking for the coffee expense from yesterday.",
    searchFilters: { text: "coffee", from: "2026-09-14", to: "2026-09-14" },
  });

  const result = await parseMessage("delete the coffee from yesterday", categories, recentExpenses, { client });

  assert.equal(result.intent, "delete-expense");
  assert.equal(result.searchFilters.text, "coffee");
});

test("create-category: returns a draft with name and parent", async () => {
  const client = fakeClient({
    intent: "create-category",
    reply: "Want me to add Pets under Home?",
    draft: { name: "Pets", parent: "Home" },
  });

  const result = await parseMessage("add a subcategory called Pets under Home", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-category");
  assert.equal(result.draft.name, "Pets");
  assert.equal(result.draft.parent, "Home");
});

test("edit-category: returns searchFilters and changes.name", async () => {
  const client = fakeClient({
    intent: "edit-category",
    reply: "Rename Fuel to Gas?",
    searchFilters: { text: "Fuel" },
    changes: { name: "Gas" },
  });

  const result = await parseMessage("rename Fuel to Gas", categories, recentExpenses, { client });

  assert.equal(result.intent, "edit-category");
  assert.equal(result.searchFilters.text, "Fuel");
  assert.equal(result.changes.name, "Gas");
});

test("delete-category: returns searchFilters", async () => {
  const client = fakeClient({
    intent: "delete-category",
    reply: "Delete the Gym subcategory?",
    searchFilters: { text: "Gym" },
  });

  const result = await parseMessage("delete the Gym subcategory", categories, recentExpenses, { client });

  assert.equal(result.intent, "delete-category");
  assert.equal(result.searchFilters.text, "Gym");
});

test("reset-categories: returns just the intent and a confirmation reply", async () => {
  const client = fakeClient({
    intent: "reset-categories",
    reply: "This resets every category to the defaults — confirm?",
  });

  const result = await parseMessage("reset my categories", categories, recentExpenses, { client });

  assert.equal(result.intent, "reset-categories");
  assert.equal(typeof result.reply, "string");
});

test("unknown: text matching none of the intents says so and changes nothing", async () => {
  const client = fakeClient({
    intent: "unknown",
    reply: "I didn't understand that — nothing was changed.",
  });

  const result = await parseMessage("what's the weather like", categories, recentExpenses, { client });

  assert.equal(result.intent, "unknown");
  assert.equal(typeof result.reply, "string");
});

test("model call failure: throws the shared { status: 502, message } shape", async () => {
  const client = {
    models: {
      generateContent: async () => {
        throw new Error("network timeout");
      },
    },
  };

  await assert.rejects(
    () => parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client }),
    (err) => {
      assert.equal(err.status, 502);
      assert.equal(typeof err.message, "string");
      return true;
    },
  );
});

test("history omitted: still calls the model, no crash", async () => {
  const client = fakeClient({
    intent: "unknown",
    reply: "I didn't understand that — nothing was changed.",
  });

  const result = await parseMessage("what's the weather like", categories, recentExpenses, { client });

  assert.equal(result.intent, "unknown");
});

test("history passed: a short answer to the assistant's pending question resolves the earlier draft", async () => {
  const history = [
    { role: "assistant", text: "I see you paid 50, but what category does this belong to?" },
    { role: "user", text: "bike" },
  ];
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — 50 under Groceries. Want me to save it?",
    drafts: [{ amount: 50, category: "Groceries" }],
  });

  const result = await parseMessage("bike", categories, recentExpenses, history, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].amount, 50);
});

test("bug A: today's date is passed into the system prompt so the model has a real clock", async () => {
  let seenPrompt;
  const client = {
    models: {
      generateContent: async ({ config }) => {
        seenPrompt = config.systemInstruction;
        return { text: JSON.stringify({ intent: "unknown", reply: "ok" }) };
      },
    },
  };

  await parseMessage("paid 40", categories, recentExpenses, [], { client, today: "2026-09-16" });

  assert.ok(seenPrompt.includes("2026-09-16"));
});

test("malformed model output: throws the shared { status: 502, message } shape", async () => {
  const client = {
    models: {
      generateContent: async () => ({ text: "not valid json" }),
    },
  };

  await assert.rejects(
    () => parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client }),
    (err) => {
      assert.equal(err.status, 502);
      assert.equal(typeof err.message, "string");
      return true;
    },
  );
});

test("malformed model output: logs the raw response text as evidence", async (t) => {
  const errorMock = t.mock.method(logger, "error", () => {});
  const rawText = "not valid json, in fact { this is half a json blob";
  const client = {
    models: {
      generateContent: async () => ({ text: rawText }),
    },
  };

  await assert.rejects(() => parseMessage("spent 50", categories, recentExpenses, { client }));

  assert.equal(errorMock.mock.callCount(), 1);
  const [message, meta] = errorMock.mock.calls[0].arguments;
  assert.match(message, /not valid JSON/i);
  assert.equal(meta.area, "ai");
  assert.equal(meta.rawResponse, rawText);
});

test("malformed model output: truncates a huge raw response to 2000 characters in the log", async (t) => {
  const errorMock = t.mock.method(logger, "error", () => {});
  const rawText = "x".repeat(5000);
  const client = {
    models: {
      generateContent: async () => ({ text: rawText }),
    },
  };

  await assert.rejects(() => parseMessage("spent 50", categories, recentExpenses, { client }));

  const [, meta] = errorMock.mock.calls[0].arguments;
  assert.equal(meta.rawResponse.length, 2000);
});

test("suspicious parsed field: logs a warning with the raw response when a store name looks like leaked JSON/HTML", async (t) => {
  const warnMock = t.mock.method(logger, "warn", () => {});
  const rawText = JSON.stringify({
    intent: "create-expense",
    reply: "Add this?",
    drafts: [{ amount: 50, store: 'supermarket", "category": "Groceries" } ] }</body></html>', category: "Groceries" }],
  });
  const client = {
    models: {
      generateContent: async () => ({ text: rawText }),
    },
  };

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(warnMock.mock.callCount(), 1);
  const [message, meta] = warnMock.mock.calls[0].arguments;
  assert.match(message, /suspicious/i);
  assert.equal(meta.area, "ai");
  assert.equal(meta.rawResponse, rawText);
});

test("clean parsed fields: does not log a warning", async (t) => {
  const warnMock = t.mock.method(logger, "warn", () => {});
  const client = fakeClient({
    intent: "create-expense",
    reply: "Add this?",
    drafts: [{ amount: 50, store: "Supermarket", category: "Groceries" }],
  });

  await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.equal(warnMock.mock.callCount(), 0);
});
