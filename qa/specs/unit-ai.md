# Test spec — `backend/ai/` (unit)

**Under test:** `backend/ai/prompt.js` (`buildPrompt`, `INTENTS`), `backend/ai/schema.js` (`responseSchema`), `backend/ai/parseMessage.js` (`parseMessage`, `getDefaultClient`), `backend/ai/index.js`.
**Governing spec:** `docs/specs/01-ai-chat.md` §6, §8.
**Level:** unit. No real network call, no `GEMINI_API_KEY` needed anywhere in this file. `parseMessage` already accepts an injectable `options.client`; for the two tests that must observe the *default* (no-`options.client`) path, `@google/genai`'s `GoogleGenAI` export is replaced with a stub constructor via `loadCjsWithStubs` so no real SDK/network call happens even then.
**Automation:** `qa/tests/unit/ai.test.ts`.

Adam's own `backend/ai/__tests__/parseMessage.test.js` (`node:test`) already covers the 7 intents' happy shapes and the two failure paths end-to-end through the fake-client seam. This spec adds what that file does not: the actual call arguments sent to `generateContent`, the shared-reference property between `prompt.js`/`schema.js`, the schema's `required`/`enum` shape, and the default-client singleton/no-construct behaviour.

---

### AI-01 — `buildPrompt` embeds `recentExpenses` verbatim and `categories` with parent names resolved
- **Purpose:** the model must see the user's real data, not a stale or empty list (spec §8 "lets the AI resolve a category by name"); a subcategory's raw `parent` id is meaningless to the model on its own, so it must see the parent's *name* instead (needed for replies like "under Food → Coffee").
- **Method:** `buildPrompt([{ name: "Fuel" }], [{ amount: 12, store: "Aroma" }])`.
- **Expected:** the returned string contains `JSON.stringify([{ amount: 12, store: "Aroma" }], null, 2)` verbatim (expenses are not transformed), and `JSON.stringify([{ name: "Fuel", parent: null }], null, 2)` for the categories block — **not** the raw input shape. **Corrected 2026-09-16**: the original version of this test asserted categories were embedded byte-for-byte from the input, which stopped being true once `buildPrompt` grew `withParentNames` (part of the same session's chat-flow fixes, `2026-09-16-chat-flow-bugs-and-fixes.md`) to resolve each subcategory's `parent` id to its main category's name before embedding. This pass's full-suite run caught the drift (the old assertion failed against the real current prompt).

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

---

## Added 2026-09-17 — the prompt-only fixes, and the seam beneath them

Bugs 1, 2, 3, 5 and 8 were fixed by adding sentences to `backend/ai/prompt.js`.
FR-42 and FR-43 already have prompt-text assertions in
`backend/ai/__tests__/prompt.test.js` (added this round) and are **not**
duplicated here. Bug 3's two rules have none, and neither does the schema
question beneath them.

These are the deterministic half. The behavioural half — does the model
actually obey — is `RG-01` … `RG-08` in `qa/specs/regression-2026-09-17.md`,
designed as rates rather than yes/no for the reason given there.

### AI-13 — the prompt states the negative-amount rule
- **Purpose:** bug 3's sign half. A prompt-text assertion is a weak test of
  behaviour and a strong test of *reversion*: it fails the moment the rule is
  edited out, deterministically and without an API call.
- **Method:** `buildPrompt(categories, recentExpenses)`; assert the text
  instructs the model never to turn a negative amount into a positive one,
  and to leave `amount` out and use intent `unknown` instead.
- **Expected:** present.
- **Note to implementer:** match on the *rule*, not on an exact sentence — the
  existing tests in `backend/ai/__tests__/prompt.test.js` use loose regexes for
  exactly this reason, so a reworded rule does not fail. Follow that pattern.

### AI-14 — the prompt states the two-decimal-places rule
- **Method:** as AI-13, for the precision half: three or more decimal places →
  do not round, do not put it in `amount`, use `unknown`.
- **Expected:** present.
- **Note:** assert the *no self-rounding* clause specifically. A rule that only
  said "at most two decimals" would be satisfied by the model rounding
  `12.345` to `12.35`, which is the failure the rule exists to prevent — the
  user confirms a number they did not type.

### AI-15 — the schema does not contradict the prompt, and cannot enforce it
- **Purpose:** the seam. `schema.js` declares
  `amount: { type: Type.NUMBER, description: "Never invented — omit if not
  stated." }`. Gemini's `Type.NUMBER` has **no** `multipleOf` and no minimum,
  so the sign and precision rules exist in the prompt only, with nothing
  structural behind them.
- **Method:** static. Assert `schema.js`'s `amount` declares no numeric
  constraint, and that this spec and `RG-02`/`RG-04` are the only places the
  constraint is claimed to live.
- **Expected:** it holds today.
- **Why assert a limitation rather than a behaviour:** so that if a future SDK
  gains `multipleOf` and someone adds it, this case fails and forces the
  design note to be updated rather than leaving two contradictory accounts of
  where the rule lives. The point of a seam check is that both declarations are
  read together.
- **Carries forward:** the real backstop is missing — `RG-04`, a blocker in
  `backend/` (Adam's).

### AI-16 — `buildPrompt` and `schema.js` agree on every field name
- **Purpose:** the seam class named in the 2026-09-17 findings — *"`backend/ai/`
  sends a category name; `backend/bl/` expected an id. Both halves passed their
  own tests."* The same hazard sits between the prompt's prose and the schema's
  declared shape: the prompt tells the model to fill fields by name, and the
  schema declares them independently.
- **Method:** static, no model. Extract every field name the schema declares
  (`intent`, `reply`, `drafts[]`, `amount`, `store`, `description`, `date`,
  `category`, `changes`, `searchFilters`, …). Extract every field name the
  prompt's rules refer to in quotes. Compare the two sets.
- **Expected:** every name the prompt instructs the model to fill is declared
  in the schema, and every schema field the server later reads is mentioned in
  the prompt. Report any name in one and not the other.
- **Why it earns its place:** it is cheap, needs no live model, runs in
  milliseconds, and catches the exact failure that produced eleven green tests
  next to a broken app. A field the prompt names and the schema omits is
  silently dropped from every response; a field the schema declares and the
  prompt never mentions is never filled.

### AI-17 — the prompt's own example uses a real arrow
- **Purpose:** `CX-06`. The prompt's category rule spells the example
  `"under Food → Coffee"` with `→`, and replies in production come back with
  `->`. Assert the prompt at least does not model the ASCII form.
- **Method:** assert `buildPrompt`'s output contains no `->` in the rules that
  demonstrate reply wording.
- **Expected:** none.
- **Severity:** low. Listed because it is the cheapest end of `CX-06` and
  costs nothing to keep.
