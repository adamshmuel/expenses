# Test spec — `backend/ai/` (unit)

**Under test:** `backend/ai/prompt.js` (`buildPrompt`, `INTENTS`), `backend/ai/schema.js` (`responseSchema`), `backend/ai/parseMessage.js` (`parseMessage`, `getDefaultClient`), `backend/ai/index.js`.
**Governing spec:** `docs/specs/01-ai-chat.md` §6, §8.
**Level:** unit. No real network call, no `GEMINI_API_KEY` needed anywhere in this file. `parseMessage` already accepts an injectable `options.client`; for the two tests that must observe the *default* (no-`options.client`) path, `@google/genai`'s `GoogleGenAI` export is replaced with a stub constructor via `loadCjsWithStubs` so no real SDK/network call happens even then.
**Automation:** `qa/tests/unit/ai.test.ts`.

Adam's own `backend/ai/__tests__/parseMessage.test.js` (`node:test`) already covers the 7 intents' happy shapes and the two failure paths end-to-end through the fake-client seam. This spec adds what that file does not: the actual call arguments sent to `generateContent`, the shared-reference property between `prompt.js`/`schema.js`, the schema's `required`/`enum` shape, and the default-client singleton/no-construct behaviour.

---

### AI-01 — `buildPrompt` embeds `categories`/`recentExpenses` verbatim
- **Purpose:** the model must see the user's real data, not a stale or empty list (spec §8 "lets the AI resolve a category by name").
- **Method:** `buildPrompt([{ name: "Fuel" }], [{ amount: 12, store: "Aroma" }])`.
- **Expected:** the returned string contains `JSON.stringify([{ name: "Fuel" }], null, 2)` and `JSON.stringify([{ amount: 12, store: "Aroma" }], null, 2)` verbatim.

### AI-02 — `buildPrompt` defaults `undefined`/`null` to `[]`, never the literal string `"undefined"`
- **Purpose:** a first-time user with no categories/expenses yet must not confuse the model with the string `"undefined"`.
- **Method:** call `buildPrompt(undefined, null)`.
- **Expected:** does not throw. The prompt does not contain the substring `"undefined"` anywhere. The categories block (text between the `## This user's categories` and `## This user's recent expenses` headers) and the expenses block (text after the recent-expenses header) each trim to exactly `"[]"` — the JSON-serialized empty array, not the words `undefined`/`null`.

### AI-03 — `buildPrompt` mentions every one of the 8 `INTENTS` values
- **Purpose:** a guard against silently dropping an intent from the instructions while `schema.js`'s enum still lists it.
- **Method:** call `buildPrompt([], [])`; for each string in `INTENTS`, check the returned prompt contains it.
- **Expected:** all 8 values (`create-expense`, `edit-expense`, `delete-expense`, `create-category`, `edit-category`, `delete-category`, `reset-categories`, `unknown`) appear in the text.

### AI-04 — `INTENTS` is exactly the 8 values, and the single shared source for both `prompt.js` and `schema.js`
- **Purpose:** the two can never drift apart (schema.js's own file comment states this design intent).
- **Method:** `require("backend/ai/prompt.js").INTENTS` and, separately, read `require("backend/ai/schema.js").responseSchema.properties.intent.enum`.
- **Expected:** `INTENTS` has exactly the 8 values, no more, no fewer. `responseSchema.properties.intent.enum === INTENTS` — reference equality (the schema imports the same array, not a copy).

### AI-05 — `responseSchema.required` is exactly `["intent", "reply"]`
- **Purpose:** which fields matter depends on the intent — nothing else is force-required (schema.js's own comment).
- **Method:** read `responseSchema.required`.
- **Expected:** deep-equals `["intent", "reply"]`.

### AI-06 — `parseMessage` sends the actual prompt/schema `buildPrompt`/`responseSchema` produce
- **Purpose:** proves the wiring, not just the return value — a regression that sends the wrong prompt or an empty schema would not be caught by asserting only `parseMessage`'s return.
- **Method:** fake `client.models.generateContent` resolving `{ text: '{"intent":"unknown","reply":"ok"}' }`. Call `parseMessage("hi", [{ name: "Fuel" }], [], { client: fakeClient })`.
- **Expected:** `generateContent` called once with `model: "gemini-flash-lite-latest"`, `contents: "hi"`, `config.systemInstruction === buildPrompt([{ name: "Fuel" }], [])`, `config.responseMimeType === "application/json"`, `config.responseSchema === responseSchema` (the same object, by reference).

### AI-07 — `parseMessage` happy path returns `JSON.parse(response.text)` unchanged
- **Purpose:** the function is a thin pass-through of the model's structured output (spec §8).
- **Method:** fake client resolves `{ text: '{"intent":"create-expense","reply":"ok","drafts":[{"amount":5}]}' }`. Call `parseMessage(...)`.
- **Expected:** resolves an object deep-equal to `{ intent: "create-expense", reply: "ok", drafts: [{ amount: 5 }] }`.

### AI-08 — a `generateContent` throw becomes the clean 502, never the raw provider error
- **Purpose:** spec §8 "It never throws a raw provider error at the route."
- **Method:** fake client's `generateContent` rejects with `new Error("ECONNRESET: upstream reset")`. Call `parseMessage("hi", [], [], { client: fakeClient })`.
- **Expected:** rejects with exactly `{ status: 502, message: "Could not reach the AI right now. Please try again." }` — not the original `Error`, not its message anywhere in the thrown value.

### AI-09 — an unparseable `response.text` becomes the same clean 502
- **Purpose:** the SDK's `responseSchema` is not itself enforced by `JSON.parse` — a malformed response must not crash the route either.
- **Method:** fake client resolves `{ text: "not json {{{" }`. Call `parseMessage("hi", [], [], { client: fakeClient })`.
- **Expected:** rejects with the identical `{ status: 502, message: "Could not reach the AI right now. Please try again." }` shape as AI-08.

### AI-10 — `getDefaultClient()` is a lazy singleton, built once
- **Purpose:** tests (and a cold server) never need a real `GEMINI_API_KEY` until the first real call, and repeated calls reuse one client (spec §8, file comment "Lazily built so tests never need a real GEMINI_API_KEY").
- **Method:** stub `@google/genai`'s `GoogleGenAI` export with a `vi.fn()` constructor that returns `{ models: { generateContent: vi.fn().mockResolvedValue({ text: '{"intent":"unknown","reply":"ok"}' }) } }` (via `loadCjsWithStubs`, so no real SDK loads). Call `parseMessage("a", [], [])` and `parseMessage("b", [], [])` — both with **no** `options.client`.
- **Expected:** the stub `GoogleGenAI` constructor is called exactly once across both calls (singleton reuse), with `{ apiKey: process.env.GEMINI_API_KEY }`.

### AI-11 — the default client is never constructed when `options.client` is supplied
- **Purpose:** every other test in this suite (and Adam's own) must never risk touching the real SDK.
- **Method:** same stub as AI-10. Call `parseMessage("hi", [], [], { client: fakeClient })` with an explicit fake client.
- **Expected:** the stub `GoogleGenAI` constructor is never called.

### AI-12 — `backend/ai/index.js` exports exactly `{ parseMessage }`
- **Purpose:** nothing outside `backend/ai/` may import `prompt.js`/`schema.js` directly (file's own header comment) — a single, stable entry point.
- **Method:** `require("backend/ai/index.js")`, inspect its keys.
- **Expected:** exported keys are exactly `["parseMessage"]`.
