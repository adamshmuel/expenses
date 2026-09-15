# AI testable surface — reference

Not a spec. A living inventory of **what exists in `backend/ai/` right now and
can be tested**, so the `qa` agent has a starting map instead of guessing. This
is a genuinely new area — it never had a file before this run — per the
folder's `README.md` ("when a genuinely new area of the system appears... it
gets its own new dated file").

Created 2026-09-15, first derivation. `backend/ai/` is Claude's code (not
Adam's) — see `.claude/rules/ownership.md` — but it is still read-only for the
`qa` agent, same as the rest of `backend/`; test code lives under `qa/`.

## Derivation state

| Covers | Last derived against | Notes |
|---|---|---|
| `backend/ai/` (`index.js`, `parseMessage.js`, `prompt.js`, `schema.js`, `__tests__/`) | commit `60c12e2` + uncommitted working-tree addition (2026-09-15, second pass) | Full first derivation 2026-09-15. Second pass same day: `parseMessage.js` gained `logger` calls on both failure paths and on success (closes the "logged apart" gap noted below) — still uncommitted, no new commit hash. No other exports or behaviour changed; Adam's own 10/10 `node --test` run confirmed unaffected. |

Before re-deriving, diff this commit against the current tree for the covered
path (`git diff --stat 60c12e2 -- backend/ai`). No changes → this file is
still current: read it, don't re-derive it. Changes → re-derive the affected
rows and bump the commit.

## How to read this

- Each row names something concrete that exists: an exported function, a
  prompt-building helper, a schema constant.
- The **"invites"** column is a prompt for the QA agent's judgement about the
  cheapest test level and the properties worth asserting — **not** a
  prescription.
- "Governed by" points at the spec section that fixes the intended behaviour.
- **"Existing coverage"** notes Adam's own `__tests__/parseMessage.test.js`
  (Node's built-in `node:test` + `assert/strict`, not Vitest/Jest — this file
  is under `backend/ai/`, Claude's code, but Claude chose Node's test runner
  for it, separate from the Node test infra `qa/` builds for itself).

---

## `backend/ai/index.js` — the only entry point

| Export | Does | Invites | Governed by |
|---|---|---|---|
| `parseMessage` | re-exports `parseMessage` from `./parseMessage.js`; nothing outside `backend/ai/` may import the other files directly | trivial — a unit test that the module's only export is `parseMessage` would catch an accidental second export leaking out, but this is very low value | `01-ai-chat.md` §8 |

## `backend/ai/parseMessage.js` — the model call

| Export | Does | Invites | Existing coverage |
|---|---|---|---|
| `parseMessage(text, categories, recentExpenses, options?)` | builds the system prompt (`buildPrompt`) + fixed `responseSchema`, calls `client.models.generateContent` (real Gemini Flash Lite by default, or `options.client` — a fake with a `models.generateContent` method — when supplied), `JSON.parse`s `response.text`, returns the parsed object; a `generateContent` throw **or** an unparseable `response.text` both become the same thrown `{ status: 502, message: "Could not reach the AI right now. Please try again." }` — never the raw provider error | already close to fully covered for the fake-client path (see existing coverage) — a `qa` pass adds: the schema/prompt actually sent to `generateContent` matches what `buildPrompt`/`responseSchema` produce (asserting the *call args*, not just the return value); `getDefaultClient()`'s lazy-singleton behaviour (built once, reused, and never constructed when a `client` option is passed — so a unit test never needs a real `GEMINI_API_KEY`); a response whose JSON parses but is missing the required `intent`/`reply` fields (the SDK's `responseSchema` is not itself enforced by `JSON.parse` — nothing in this function re-validates shape, worth flagging as a **gap**, not silently assumed safe) | `backend/ai/__tests__/parseMessage.test.js` — one `node:test` file, 9 tests: the 7 intents' happy paths (`create-expense` incl. `drafts[]`, `edit-expense`'s `searchFilters`+`changes`, `delete-expense`, `create-category`, `edit-category`, `delete-category`, `reset-categories`), `unknown`, and the two failure paths (`generateContent` throws; `response.text` is not valid JSON) both asserting the shared `{status:502, message}` shape. All 9 use a `fakeClient` matching the real SDK's `{ text }` response shape — a genuine unit test, no real network call |

Governed by: `01-ai-chat.md` §6, §8 (the seven intents, the output shapes, "never
throws a raw provider error", "never invents an amount").

## `backend/ai/prompt.js` — system instructions

| Export | Does | Invites | Governed by |
|---|---|---|---|
| `buildPrompt(categories, recentExpenses)` | returns one template string embedding the seven-intent rules plus `JSON.stringify(categories)`/`JSON.stringify(recentExpenses)`; defaults both to `[]` when `undefined`/`null` (via `?? []`) | unit: the returned string contains the serialized categories/expenses verbatim (so the model actually sees the user's real data, not a stale/empty list); `undefined` categories/expenses do not throw, and produce `[]` in the output rather than the literal string `"undefined"`; every one of the 8 `INTENTS` values appears somewhere in the prompt text (a guard against silently dropping an intent from the instructions while `schema.js`'s enum still lists it) | `01-ai-chat.md` §6, §8 |
| `INTENTS` (exported constant) | the 8 allowed `intent` enum values (`create-expense`, `edit-expense`, `delete-expense`, `create-category`, `edit-category`, `delete-category`, `reset-categories`, `unknown`) — imported by both `prompt.js` (written into the instructions) and `schema.js` (the `responseSchema` enum), so the two can never drift apart | unit: exactly these 8 values, no more, no fewer — this single array being the shared source is itself the property worth asserting (import it from both call sites in the test and confirm reference equality, not just value equality) | `01-ai-chat.md` §6, §8 |

## `backend/ai/schema.js` — the fixed response shape

| Export | Does | Invites | Governed by |
|---|---|---|---|
| `responseSchema` | one flat Gemini `responseSchema` object (not a per-intent `anyOf`, deliberately — see the file's own comment on the SDK's limited OpenAPI-3.0 subset): `intent` (enum, required), `reply` (string, required), `drafts` (array of a flat draft-expense shape), `draft` (category shape: `name`, nullable `parent`), `searchFilters` (`text`/`from`/`to`, all optional strings), `changes` (a flat union of expense-edit and category-edit fields) | this is passed straight to the Gemini SDK, not evaluated by app code — a JSON-Schema-shaped **unit test is still worth writing**: confirm `required` is exactly `["intent","reply"]` (nothing else is force-required, since which fields matter depends on the intent) and that `intent`'s `enum` is the same `INTENTS` array from `prompt.js` (see above) — those two properties are what stop the model's output space from silently drifting from what `parseMessage` actually reads out of the response. Not worth integration-testing against the real Gemini API in this pass (network, cost, non-determinism) — see "Known blockers" below | `01-ai-chat.md` §8 |

---

## Cross-cutting: `backend/ai/` as a boundary

| Behaviour | What to assert | Governed by |
|---|---|---|
| Never touches the database | `parseMessage`'s only side effect is the `generateContent` call — no `require` of any `dal/`, `bl/`, or model file anywhere in `backend/ai/` (a static grep-based check is cheap and exact here, cheaper than trying to prove a negative at runtime) | `01` §8, `08-expense-category-dal.md` "backend/ai/ and the DAL" |
| The Gemini API key never reaches the client | `GEMINI_API_KEY` is read once, server-side, inside `getDefaultClient()`; grep `client/src` for the string confirms it is never bundled | `01` §8 |
| A provider failure always becomes a clean `502`, never a 500 or a raw stack trace | already covered at the unit level (see `parseMessage.js` row) — the **cross-cutting** half is proving `routes/chatRoute.js` actually turns that thrown `{status:502,...}` into an HTTP 502 via `errorHandler` (`06-server-modules.md` §3's generic `.status` branch) — that's an API-level test against `POST /chat/messages`, not a `backend/ai/` unit test; noted here so it isn't lost, designed in the server file's chat section once written | `01` §8, `06` §3 |
| Logged apart from other request logs | **Closed** (2026-09-15, second pass): `parseMessage.js` now calls `logger.error(..., { area: "ai" })` on both failure paths (the `generateContent` throw; an unparseable `response.text`) and `logger.info(..., { area: "ai" })` with the parsed intent on success. `.config/logger.js`'s `ai.log` transport (tested in `qa/specs/int-logger.md`, LG-*) now has a real source. Adam confirmed `node --test backend/ai/__tests__/parseMessage.test.js` still passes 10/10 and `backend/logs/ai.log` has content. No new `qa/` test added this pass (the logger transport itself is already covered by LG-*; asserting the exact call site would be testing the implementation, not a behaviour) — worth a light integration check later if the log content itself becomes load-bearing. | `01` §9 ("AI calls logged apart"), `06` §1 |

---

## Known blockers to testing

| Blocker | Consequence | Work-around |
|---|---|---|
| Real calls to Gemini Flash Lite cost money, are non-deterministic, and need `GEMINI_API_KEY` | Can't run `parseMessage` against the real model in an automated suite | **worked around at the unit level**: `parseMessage(..., { client })` already accepts an injected fake client — same pattern Adam's own `__tests__/parseMessage.test.js` uses. `qa/` unit tests for `prompt.js`/`schema.js`/the `getDefaultClient` singleton need no network at all |
| No route yet turns a `backend/ai/` 502 into an observed HTTP response in isolation | The cross-cutting "clean 502" property (row above) can only be proven once `routes/chatRoute.js` is inventoried and its own API tests are designed (this run does not design chat's server-file rows — chat's route/service/model rows belong in the server testable-surface file, updated separately this run) | Not a blocker to the `backend/ai/` file itself — cross-referenced above so the future test-writing pass doesn't lose the link |

---

## Not yet built

Nothing known — the four files above are the whole of `backend/ai/` as scoped
by spec `01-ai-chat.md` §8 ("one function... Claude writes it").

---

## Maintenance

The `qa` agent re-derives this document against the real `backend/ai/` code at
the start of every run (gated by the Derivation state table above) and updates
it if it has drifted. Keep it a plain inventory: what exists, what it's
governed by, what it invites, what already has coverage. No test counts, no
pass/fail, no strategy prose.
