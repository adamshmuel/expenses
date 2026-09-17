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

test("malformed model output: a malformed-JSON response is treated as degeneration -- retried, then refused rather than thrown", async () => {
  // A malformed-JSON response is exactly the kind of degeneration the retry
  // exists for (a captured real case: a 67KB unterminated-string response).
  // This stub returns the same bad text on both the first attempt and the
  // retry, so parseMessage returns the garbled-response refusal rather than
  // throwing AI_UNAVAILABLE_ERROR -- that throw is reserved for a genuine API
  // failure (see the "model call failure" test above), not a bad body.
  const client = {
    models: {
      generateContent: async () => ({ text: "not valid json" }),
    },
  };

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("malformed model output: logs the raw response text as evidence on every attempt", async (t) => {
  const warnMock = t.mock.method(logger, "warn", () => {});
  const rawText = "not valid json, in fact { this is half a json blob";
  const client = {
    models: {
      generateContent: async () => ({ text: rawText }),
    },
  };

  await parseMessage("spent 50", categories, recentExpenses, { client });

  const jsonWarnings = warnMock.mock.calls.filter(({ arguments: [message] }) => /not valid JSON/i.test(message));
  assert.equal(jsonWarnings.length, 2); // one per attempt: first call, then the retry
  const [message, meta] = jsonWarnings[0].arguments;
  assert.match(message, /not valid JSON/i);
  assert.equal(meta.area, "ai");
  assert.equal(meta.rawResponse, rawText);
});

test("malformed model output: truncates a huge raw response to 2000 characters in the log", async (t) => {
  const warnMock = t.mock.method(logger, "warn", () => {});
  const rawText = "x".repeat(5000);
  const client = {
    models: {
      generateContent: async () => ({ text: rawText }),
    },
  };

  await parseMessage("spent 50", categories, recentExpenses, { client });

  const jsonWarnings = warnMock.mock.calls.filter(({ arguments: [message] }) => /not valid JSON/i.test(message));
  const [, meta] = jsonWarnings[0].arguments;
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

  // Bug 5: the suspicious field used to be logged and then passed through
  // unchanged (this test's old assertion). It is now refused the same way
  // as the other garbled-response shapes -- see the "bug 5" tests below.
  // This stub returns the same suspicious field on both the first attempt
  // and the retry, so the "suspicious field" warning fires twice (one per
  // attempt), plus one more warning noting the retry itself fired.
  assert.equal(result.intent, "unknown");
  assert.equal(result.drafts, undefined);
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
  const suspiciousWarnings = warnMock.mock.calls.filter(({ arguments: [message] }) => /suspicious/i.test(message));
  assert.equal(suspiciousWarnings.length, 2);
  const [message, meta] = suspiciousWarnings[0].arguments;
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

test("bug 3a: a negative amount in the user's text is never confirmed as its positive value", async () => {
  // The model got it wrong (dropped the minus sign) — this is the exact
  // real-world response captured in the bug report, not a hypothetical.
  const client = fakeClient({
    intent: "create-expense",
    reply: "I've noted 50 under Food → Coffee. Would you like me to save this expense?",
    drafts: [{ amount: 50, description: "coffee", category: "Food" }],
  });

  const result = await parseMessage("spent -50 on coffee", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.equal(result.drafts, undefined);
  assert.match(result.reply, /negative|can't|cannot|can not|n't be negative|positive/i);
});

test("bug 3a: a positive amount in the user's text is unaffected by the negative-amount guard", async () => {
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [{ amount: 50, store: "supermarket", category: "Groceries" }],
  });

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].amount, 50);
});

test("bug 3b: an amount with three decimal places is rejected rather than saved as-is", async () => {
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [{ amount: 12.345, store: "supermarket", category: "Groceries" }],
  });

  const result = await parseMessage("spent 12.345 at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.equal(result.drafts, undefined);
  assert.match(result.reply, /agorot|decimal|two decimal|cent|round/i);
});

test("bug 3b: an edit-expense change with three decimal places is rejected the same way", async () => {
  const client = fakeClient({
    intent: "edit-expense",
    reply: "Changing it to 12.345 — want me to save it?",
    searchFilters: { text: "IKEA" },
    changes: { amount: 12.345 },
  });

  const result = await parseMessage("change the ikea expense to 12.345", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "edit-expense");
  assert.equal(result.changes, undefined);
  assert.match(result.reply, /agorot|decimal|two decimal|cent|round/i);
});

test("bug 3b: an amount with two decimal places is unaffected by the precision guard", async () => {
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [{ amount: 12.34, store: "supermarket", category: "Groceries" }],
  });

  const result = await parseMessage("spent 12.34 at the supermarket", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].amount, 12.34);
});

test("bug 5: a suspicious free-text field is refused rather than passed through to the caller", async () => {
  // Verbatim capture from the qa-tester run (docs/reference/testing-reference):
  // input "paid 25 for the thing at the supermarket" produced a store field
  // whose first token is correct ("supermarket") but which then leaks the
  // model's own deliberation about the prompt's rules, plus a stray empty
  // second draft `{}`. The existing hasSuspiciousField check detects this
  // (see the "suspicious parsed field" test above) but previously only
  // logged a warning and returned the garbage-bearing object unchanged.
  const rawText = JSON.stringify({
    intent: "create-expense",
    reply: "I have an expense of 25 at the supermarket under Food → Groceries, want me to add this?",
    drafts: [
      {
        amount: 25,
        store:
          "supermarket Mapped Merchant Name Placeholder Or Just Store Name If Known Or None If Unclear No I'll Use supermarket As Store And description As the thing Or Groceries Category Directly Since Supermarket Plausibly Matches Food → Groceries Or Similar Actually The Supermarket Is Store, Description Is the thing, Category Is Groceries under Food. Wait Let's keep store as supermarket, description as the thing, and category as Groceries under Food because supermarket matches Groceries category under Food. Wait rule says category must be the name of one of the existing categories. Groceries is under Food. Let's put category Groceries since supermarket matches Groceries. Wait rule says category must be an existing category name. Groceries is one. Let's set category: Groceries, store: supermarket, description: the thing, date: 2026-09-17, amount: 25.",
      },
      {},
    ],
  });
  const client = {
    models: {
      generateContent: async () => ({ text: rawText }),
    },
  };

  const result = await parseMessage("paid 25 for the thing at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.equal(result.drafts, undefined);
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 5: an empty draft element ({}) is dropped from drafts rather than passed through", async () => {
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [{ amount: 50, store: "supermarket", category: "Groceries" }, {}],
  });

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].amount, 50);
});

test("bug 5 shape 2: a correct value followed by a wall of foreign-script garbage is refused", async () => {
  // Verbatim capture from the qa-tester verification run (trial 1 of the
  // "spent 50 at the supermarket on groceries" regression check): the store
  // field starts with the correct English value, then a repetition-collapse
  // tail in Burmese script is appended. It stays under the 200-char length
  // cap, so the length check alone does not catch it — the signal has to be
  // "this field mixes in a script this app has no legitimate reason to
  // contain", not length.
  const rawText = JSON.stringify({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [
      {
        amount: 50,
        store:
          "the supermarketသမာရ်ကက်ပိုင်ရှင်များသို့မဟုတ်စူပါမားကတ်ဝယ်ယူမှုများအတွက်ဈေးဝယ်စင်တာများသို့သွားရောက်ခြင်းအတွက်ကျေးဇူးတင်ရှိပါသည်",
      },
    ],
  });
  const client = {
    models: {
      generateContent: async () => ({ text: rawText }),
    },
  };

  const result = await parseMessage("spent 50 at the supermarket on groceries", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.equal(result.drafts, undefined);
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 5 shape 2: legitimate Hebrew text in a free-text field is not flagged", async () => {
  // The app supports Hebrew input/output (spec 01-ai-chat.md); the foreign-
  // script guard must key on "a script this app never uses", not "non-Latin",
  // or it would break a real, supported user flow.
  const client = fakeClient({
    intent: "create-expense",
    reply: "הוספתי הוצאה אחת.",
    drafts: [{ amount: 50, store: "סופרמרקט", category: "Groceries" }],
  });

  const result = await parseMessage("שילמתי 50 בסופרמרקט", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].store, "סופרמרקט");
});

test("bug 5 shape 3: reply coming back as the literal string \"undefined\" is refused, not shown to the user", async () => {
  // Verbatim capture: trials 0 and 4 of the same verification run returned
  // drafts=[] and reply="undefined" — not the JS value, the four-letter
  // string. The existing guards never look at "reply" itself, only at
  // drafts/draft/changes, so this shape reached the user unchanged before.
  const client = fakeClient({
    intent: "create-expense",
    reply: "undefined",
    drafts: [],
  });

  const result = await parseMessage("spent 50 at the supermarket on groceries", categories, recentExpenses, { client });

  assert.notEqual(result.reply, "undefined");
  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 5 shape 3: an empty-string reply is refused the same way", async () => {
  const client = fakeClient({
    intent: "unknown",
    reply: "",
  });

  const result = await parseMessage("spent 50 at the supermarket on groceries", categories, recentExpenses, { client });

  assert.notEqual(result.reply, "");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 5: a giant raw response is refused before attempting to parse it, rather than paying the parse/log cost", async () => {
  // The findings doc records a real 207,000-character capture. A budget-app
  // parse response has no legitimate reason to be anywhere near that size —
  // this is a cheap structural backstop, independent of what shape the
  // garbage takes once decoded.
  const hugeText = JSON.stringify({
    intent: "create-expense",
    reply: "pharmacy ".repeat(30000),
    drafts: [{ amount: 50, store: "pharmacy" }],
  });
  const client = {
    models: {
      generateContent: async () => ({ text: hugeText }),
    },
  };

  const result = await parseMessage("spent 50 at the pharmacy", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 5: an ordinary response well under the length cap is unaffected", async () => {
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [{ amount: 50, store: "supermarket", category: "Groceries" }],
  });

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].amount, 50);
});

test("size ceiling: a response just under 8192 bytes passes through unchanged", async () => {
  const base = { intent: "create-expense", reply: "", drafts: [{ amount: 50, store: "Aroma", category: "Groceries" }] };
  const overhead = Buffer.byteLength(JSON.stringify(base), "utf8");
  base.reply = "a".repeat(8191 - overhead); // total raw response: 8191 bytes, just under the cap
  const rawText = JSON.stringify(base);
  assert.ok(Buffer.byteLength(rawText, "utf8") < 8192);

  const client = { models: { generateContent: async () => ({ text: rawText }) } };

  const result = await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].store, "Aroma");
});

test("size ceiling: a Hebrew reply well under 8192 bytes is accepted, even though its character count alone would fail a conservative per-character cap", async () => {
  // Hebrew characters are 2 bytes each in UTF-8 but count as one JS string
  // character (.length is UTF-16 code units). A char-based cap sized
  // conservatively for the worst case (4 bytes/char) would sit around
  // 8192 / 4 = 2048 characters -- well below what this reply needs, even
  // though its real byte size is comfortably under the true 8192-byte cap.
  // This is why the check has to measure real bytes, not .length.
  const base = { intent: "create-expense", reply: "", drafts: [{ amount: 50, store: "סופרמרקט", category: "Groceries" }] };
  const overhead = Buffer.byteLength(JSON.stringify(base), "utf8");
  const hebrewChar = "א"; // 2 bytes in UTF-8, 1 UTF-16 code unit
  base.reply = hebrewChar.repeat(Math.floor((8000 - overhead) / 2));
  const rawText = JSON.stringify(base);
  assert.ok(Buffer.byteLength(rawText, "utf8") < 8192);
  assert.ok(base.reply.length > 2048); // would fail a naive char-count cap sized for 8192 bytes worst-case

  const client = { models: { generateContent: async () => ({ text: rawText }) } };

  const result = await parseMessage("שילמתי 50 בסופרמרקט", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].store, "סופרמרקט");
});

test("bug 6: response.text undefined (real SDK degeneration) is refused, not a crash", async () => {
  // Reproduces the crash reported against the real Gemini API: the SDK can
  // resolve with `{ text: undefined }` under the same degeneration bug 5's
  // length guard exists to catch. Line 190 used to read `.length` straight
  // off `response.text` instead of the already-safe `rawResponse` computed
  // one line above it, so this threw a raw TypeError instead of reaching the
  // garbled-response reply.
  const client = {
    models: {
      generateContent: async () => ({ text: undefined }),
    },
  };

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 6: response.text null is refused the same way", async () => {
  const client = {
    models: {
      generateContent: async () => ({ text: null }),
    },
  };

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 6: response.text empty string is refused the same way", async () => {
  const client = {
    models: {
      generateContent: async () => ({ text: "" }),
    },
  };

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 6: response.text a non-string (e.g. a number) is refused the same way", async () => {
  const client = {
    models: {
      generateContent: async () => ({ text: 42 }),
    },
  };

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
});

test("bug 3b: a whole-number amount is unaffected by the precision guard", async () => {
  const client = fakeClient({
    intent: "create-expense",
    reply: "Got it — adding one expense.",
    drafts: [{ amount: 50, store: "supermarket", category: "Groceries" }],
  });

  const result = await parseMessage("spent 50 at the supermarket", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].amount, 50);
});

// --- retry on a garbled response (docs/plans retry work) ---------------

/**
 * A fake client whose `generateContent` returns a different `{ text }` (or
 * throws) on each successive call, in order. Also counts calls so tests can
 * assert exactly how many attempts were made.
 */
function sequenceClient(responses) {
  let call = 0;
  return {
    calls: () => call,
    models: {
      generateContent: async () => {
        const next = responses[Math.min(call, responses.length - 1)];
        call += 1;
        if (next.throws) throw next.throws;
        return { text: next.text };
      },
    },
  };
}

test("retry: a garbled first response followed by a good one succeeds on the retry, calling the model exactly twice", async () => {
  const client = sequenceClient([
    { text: "" }, // bug 6 shape: unusable text
    { text: JSON.stringify({ intent: "create-expense", reply: "Got it — adding one expense.", drafts: [{ amount: 50, store: "Aroma", category: "Groceries" }] }) },
  ]);

  const result = await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].store, "Aroma");
  assert.equal(client.calls(), 2);
});

test("retry: a malformed-JSON first response followed by a good one succeeds on the retry", async () => {
  const client = sequenceClient([
    { text: "not valid json {" },
    { text: JSON.stringify({ intent: "create-expense", reply: "Got it — adding one expense.", drafts: [{ amount: 50, store: "Aroma", category: "Groceries" }] }) },
  ]);

  const result = await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(client.calls(), 2);
});

test("retry: two garbled responses in a row exhausts the retry and returns the refusal, calling the model exactly twice", async () => {
  const client = sequenceClient([{ text: "" }, { text: "" }]);

  const result = await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
  assert.equal(client.calls(), 2);
});

test("size ceiling: an oversized first response (over 8192 bytes) retries and succeeds with a normal second response", async () => {
  const client = sequenceClient([
    { text: "x".repeat(9000) }, // well over the 8192-byte cap, caught before JSON.parse
    { text: JSON.stringify({ intent: "create-expense", reply: "Got it — adding one expense.", drafts: [{ amount: 50, store: "Aroma", category: "Groceries" }] }) },
  ]);

  const result = await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(result.drafts[0].store, "Aroma");
  assert.equal(client.calls(), 2);
});

test("size ceiling: two oversized responses in a row exhausts the retry and refuses, not a 502", async () => {
  const client = sequenceClient([{ text: "x".repeat(9000) }, { text: "y".repeat(9000) }]);

  const result = await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.match(result.reply, /trouble|try again|didn't come out right|something went wrong|rephrase/i);
  assert.equal(client.calls(), 2);
});

test("retry: a good response first time calls the model exactly once, no retry", async () => {
  const client = sequenceClient([
    { text: JSON.stringify({ intent: "create-expense", reply: "Got it — adding one expense.", drafts: [{ amount: 50, store: "Aroma", category: "Groceries" }] }) },
  ]);

  const result = await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  assert.equal(result.intent, "create-expense");
  assert.equal(client.calls(), 1);
});

test("retry: a genuine API failure (network error) is not retried — fails fast with exactly one call", async () => {
  const client = sequenceClient([{ throws: new Error("network timeout") }, { text: "{}" }]);

  await assert.rejects(
    () => parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client }),
    (err) => {
      assert.equal(err.status, 502);
      return true;
    },
  );
  assert.equal(client.calls(), 1);
});

test("retry: bug 3a (negative amount in user text) is not retried — it's a correct refusal of real input, exactly one call", async () => {
  const client = sequenceClient([
    { text: JSON.stringify({ intent: "create-expense", reply: "Noted 50 under Food.", drafts: [{ amount: 50, description: "coffee", category: "Food" }] }) },
  ]);

  const result = await parseMessage("spent -50 on coffee", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.equal(client.calls(), 1);
});

test("retry: bug 3b (sub-agora precision) is not retried — it's a correct refusal of real input, exactly one call", async () => {
  const client = sequenceClient([
    { text: JSON.stringify({ intent: "create-expense", reply: "Got it.", drafts: [{ amount: 12.345, store: "supermarket", category: "Groceries" }] }) },
  ]);

  const result = await parseMessage("spent 12.345 at the supermarket", categories, recentExpenses, { client });

  assert.notEqual(result.intent, "create-expense");
  assert.equal(client.calls(), 1);
});

test("retry: logs a warning noting the retry fired, and an info line noting the retry succeeded", async (t) => {
  const warnMock = t.mock.method(logger, "warn", () => {});
  const infoMock = t.mock.method(logger, "info", () => {});
  const client = sequenceClient([
    { text: "" },
    { text: JSON.stringify({ intent: "create-expense", reply: "Got it — adding one expense.", drafts: [{ amount: 50, store: "Aroma", category: "Groceries" }] }) },
  ]);

  await parseMessage("spent 50 at Aroma on coffee", categories, recentExpenses, { client });

  const retryLine = warnMock.mock.calls.find(({ arguments: [message] }) => /retry/i.test(message));
  assert.ok(retryLine, "expected a warn log mentioning the retry");

  const successLine = infoMock.mock.calls.find(({ arguments: [message] }) => /retry/i.test(message));
  assert.ok(successLine, "expected an info log noting the retry succeeded");
});
