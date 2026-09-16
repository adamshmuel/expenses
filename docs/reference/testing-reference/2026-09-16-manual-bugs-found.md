# Bugs found manually, before QA coverage existed for them

Not a testable-surface inventory like the other files in this folder — this
one is a record of real bugs Adam found by using the app manually, plus one
finding about `qa/`'s own assertion style, kept here so that once QA coverage
is written we can check whether it would have caught them. Written before any
fix was made.

## Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| `backend/bl/categoryService.js`, chat confirm flow (`backend/routes/chatRoute.js` → `backend/bl/expenseService.js` → `backend/bl/categoryService.js`) | commit `6b31ea4` | Found manually via the `/home` chat UI, 2026-09-16. Not yet fixed as of this writing. |

## Bug 1 — `POST /chat/confirm` 500s: `findByName` crashes on undefined `.toLowerCase()`

- **Symptom**: user sends "spent 500 at the supermarket" in chat, gets a clean
  draft back (`create-expense`, category "Groceries", ₪500.00), clicks
  Confirm, server returns 500.
- **Root cause**: `backend/bl/categoryService.js:37`, inside `findByName`:
  ```js
  const nameMatches = category.name.toLowerCase() === name.toLowerCase();
  ```
  Neither `category.name` nor `name` (the argument) is guarded against
  `undefined`. Server log (`backend/logs/error.log`, 2026-09-16T07:15:16.088Z):
  ```
  TypeError: Cannot read properties of undefined (reading 'toLowerCase')
      at backend/bl/categoryService.js:37:66
      at Array.filter
      at Object.findByName (categoryService.js:36:27)
      at async resolveCategory (expenseService.js:13:22)
      at async Object.createExpense (expenseService.js:42:25)
      at async chatRoute.js:93:19
  ```
- **Reached from**: `chatRoute.js:93` → `expenseService.createExpense` →
  `expenseService.resolveCategory` (private) → `categoryService.findByName`.
- **Why QA coverage likely missed it**: the existing inventory
  (`2026-09-15-server-additions-testable.md`, `bl/categoryService.js` row for
  `findByName`) already names this exact function and lists as its invited
  tests "case-insensitivity; zero/one/several matches; parent scoping" — all
  of which assume `name` is always a defined string. No row anywhere invites a
  test for `name` (or a category's own `name`) being `undefined` or missing.
  The gap is in the **invited test list itself**, not in execution of what
  was already invited.
- **Open question, now answered.** A temporary log inside the filter printed
  `{ name: undefined, categoryName: 'Food' }` — so it is the *argument* that
  is undefined, never a category document missing its own name. It happens
  when the AI returns a create-expense draft with no `category` at all (the
  message "paid 50" gives no category signal), and the client then offers
  Confirm anyway. See bug 7 in
  `2026-09-16-chat-flow-bugs-and-fixes.md` for that half.
- **Fixed 2026-09-16** (commit `6a5c48d`). `resolveCategory` now rejects a
  missing category name with a 400 ("Which category should this go under?")
  before `findByName` is reached, matching how that function already reports
  its other two failure cases. **Note this fix alone did not unblock the
  user** — it turned a 500 into a 400, and four further bugs (7-10 in the
  companion file) sat behind it. The flow only worked end to end after all
  five were fixed.

## Bug 2 — chat draft card rendered raw JSON/HTML fragments to the user

- **Symptom**: the confirm card, on the success path (a clean `create-expense`
  draft), displayed literal unparsed text instead of a clean summary line:
  ```
  supermarket", "category": "Groceries", "date": "2023-10-24" } ] }</body></html>
  ```
  This is inside the app's own draft card (`chat-drafts` list, per
  `HomePage.tsx`), not a browser extension overlay — a first pass at this
  investigation wrongly dismissed it as devtools noise from a wider
  screenshot; a tighter screenshot from Adam confirmed it renders inside the
  card itself. Corrected here.
- **Root cause, as far as logs allow**: `backend/logs/ai.log` /`app.log` show
  only a clean `AI parsed intent: create-expense` and a 200 on
  `POST /chat/messages`, with no parse error logged — logs capture status/size,
  not response bodies, so the actual malformed string can't be recovered after
  the fact. Given `backend/ai/schema.js` types `store`/`description` as plain
  `STRING` fields (Gemini's `responseSchema` should prevent nested JSON
  structurally), the more likely path is the **model itself generating**
  garbled text as the *content* of a string field — not a client-side parse
  bug — though this isn't confirmed without the raw payload.
- **The real bug regardless of root cause**: `client/` renders `draft.store` /
  `draft.description` straight from the server with no validation that the
  content is sane before showing it to the user (`chatSlice.ts`'s `toPending`
  trusts `result.drafts` as-is; `HomePage.tsx`'s render is a plain string
  interpolation). Spec `01-ai-chat.md` §5 describes drafts as clean structured
  fields shown for confirmation — it does not anticipate or allow raw AI
  output artifacts reaching the user. This is a design violation, not just a
  glitch.
- **Why QA coverage likely missed it**: no row in
  `2026-09-15-client-additions-testable.md` (chat UI) invites a test for
  "AI returns a syntactically-valid-but-garbage string in `store`/
  `description`" — every invited test assumes the field content is
  well-formed. This is the same category of gap as Bug 1: the invited test
  list didn't cover malformed *content* inside an otherwise well-typed field.
- **Not yet fixed.** Fix belongs on the client: validate/sanitize draft string
  fields before rendering (e.g. reject or truncate values containing HTML/JSON
  syntax) so malformed AI output can never reach the confirm card as-is.

## Bug 3 — logs don't carry enough detail to debug an error after the fact

- **Symptom**: investigating Bug 2, `backend/logs/ai.log` / `app.log` recorded
  only status codes and response sizes for the request — not the request body
  or the AI's actual response payload. Once the error happened, there was no
  way to recover what the model actually returned.
- **Why this matters**: an error log that can't answer "what was the actual
  input/output when this broke" doesn't serve debugging — the point of
  logging an error is to reconstruct it without reproducing it live.
- **Owner**: `backend/` logging setup is Adam's own code — his call on what
  to add (e.g. logging the request body and raw AI response on error).
- **Request-body half fixed 2026-09-16.** `errorHandler` in
  `backend/error_handling.js` now logs `body: safeBody(req.body)` alongside
  method/path/stack, on all three branches (409, deliberate 4xx, and 500).
  `safeBody` shallow-copies the body and replaces a `password` field with
  `"[redacted]"`, so a failed login cannot write a plaintext password into
  the logs. Verified both ways: a failed `/chat/confirm` now records its full
  `{ intent, drafts: [...] }` payload, and a failed `/users/login` records
  `{"username":"AdamShmuel","password":"[redacted]"}` — the real password
  appears zero times across all five log files.
- **Still open — the AI response half.** The model's raw output is still not
  logged, which was the *other* thing missing when Bug 2 could not be
  diagnosed: `ai.log` records `AI parsed intent: create-expense` but never
  what the model actually returned, so a malformed field cannot be recovered
  after the fact. That belongs in `backend/ai/parseMessage.js` — Claude's
  file, not Adam's.

## Bug 4 — new expenses get the wrong date; dashboard then can't find them

- **Symptom**: sent "spent 200 on coffee" (no date stated) on 2026-09-16. The
  saved MongoDB doc has `date: 2026-05-16T00:00:00.000Z` — four months off.
  Dashboard's "Today" and "This month" views then show empty, because the
  expense is outside the queried `from`/`to` range — the dashboard's
  `expenses?from=...&to=...` request itself is correct; it's asking for
  September and the expense is dated May.
- **Root cause**: `backend/ai/prompt.js:58` tells the model "Date defaults to
  today when the message does not state one" but never tells the model what
  today's actual date is — the LLM has no wall-clock access, and nothing in
  `parseMessage.js` injects the real current date into the prompt or context.
  The model is left to guess, and guessed wrong.
- **Owner**: `backend/ai/` is Claude's code — this is Claude's bug to fix, not
  Adam's.
- **Why QA coverage likely missed it**: a date-defaulting test would likely
  check that a date is *present*, not that it equals the real current date —
  same "well-typed but wrong content" blind spot as Bug 2.
- **Fixed 2026-09-16** (commit `6a5c48d`). `buildPrompt` now takes a `today`
  argument — injectable so tests can pin it, defaulting to the real clock —
  and states the date in the rules, with an instruction to resolve relative
  dates ("yesterday") against it. Tests in `backend/ai/__tests__/` assert the
  date reaches the prompt; they were watched failing first. Verified in the
  database afterwards: an expense recorded on 2026-09-16 stores
  `2026-09-16`, and appears on the dashboard's Today view.

## Bug 5 — no confirm outcome is ever written to the chat history (success or failure)

**Widened 2026-09-16, later the same day.** Originally logged as a
*failed*-save problem; Adam then found the success path has the identical
hole. After confirming an expense the chat shows "Done." — navigate to the
dashboard and back, and "Done." is gone. It lived only in browser memory.

So the rule is simply: **`POST /chat/confirm` never persists a `Message`, in
any outcome.** The chat records what the user asked for and what the assistant
proposed, but never what actually happened. For an app whose spec says the
chat is the only way to change anything, the audit trail is missing exactly
the half that matters. Same single fix covers both cases: persist an
assistant message in the confirm handler, for success and for failure alike.

The original failure-case write-up follows.

- **Symptom**: logging out and back in, the chat history reads:
  "spent 500 at the supermarket" → "I've drafted an expense of 500 at the
  supermarket under Groceries. Would you like me to save it?" — and nothing
  more. Nothing says the save was ever attempted, or that it failed three
  times. The history reads as if the user simply never confirmed.
- **What actually happened** (from `backend/logs/app.log`, 2026-09-16):
  `POST /chat/messages` 200 at 07:14:04, then `POST /chat/confirm` **500** at
  07:15:16, 07:15:32 and 07:20:02 — three failed attempts, all Bug 1. The
  expense was never saved, which is why the DB holds only the coffee row.
- **Why it's a bug, not cosmetic**: the chat *is* the audit trail of this app
  (spec `00-overview.md`: the chat is the only way to change anything). A
  history that shows a draft proposal with no recorded outcome is actively
  deceiving — the user cannot tell "I never confirmed" from "I confirmed and
  it failed". The transient red "Something went wrong." banner is gone after
  a reload and was never persisted.
- **Related**: the reply text also carries no correlation handle (request id
  or timestamp), so a message in the UI cannot be tied to its server log line
  when investigating after the fact. Compounds [[Bug 3]].
- **Owner: Adam — `backend/routes/chatRoute.js`.** `POST /chat/messages`
  already persists two `Message` rows per turn (line 37 the user's text, line
  60 the assistant's reply). `POST /chat/confirm` persists **none**: it calls
  the service, returns `{ changed }`, and on a throw `catchAsync` hands the
  error to the error handler — the outcome, success or failure, is never
  written. The route already has the `Message` model imported (line 8) and
  the pattern established; the confirm handler simply doesn't use it.
  `client/` is not at fault — it renders the history the server returns, and
  the server returns nothing to render.
- **Fixed 2026-09-16.** `/chat/confirm` now persists an assistant message in
  both outcomes: `"Done."` after a successful change, and the thrown error's
  own `message` when one fails (the switch is wrapped in try/catch, which
  records and then re-throws, so the HTTP status the client receives is
  unchanged). Verified both ways — a confirmed expense's "Done." survives
  navigating away and back, and a deliberately failing confirm
  (`category: "ghost-category-zzz"`, driven straight at the endpoint since
  the UI now refuses to offer that draft at all) leaves
  `No category named "ghost-category-zzz". Create it first?` in the
  `messages` collection.
- **Still open, smaller**: the messages carry no request id or timestamp
  handle, so a chat line still cannot be tied to its server log entry. See
  [[Bug 3]].

## Bug 6 — typing "yes" to confirm does nothing useful

- **Symptom**: assistant asks "Would you like me to save it?"; user types
  `yes` in the message box; assistant replies "I'm not sure what you mean by
  'yes'. How can I help you with your budget?"
- **Why it happens (working as built, not a crash)**: confirming is a **UI
  button** — `HomePage.tsx`'s Confirm sends `POST /chat/confirm` from
  `state.pending`. Free text goes to `POST /chat/messages` instead, where the
  AI parses it as a brand-new message against the seven intents in
  `backend/ai/prompt.js`. There is no "affirm/confirm" intent, so `yes`
  correctly lands on `unknown` (logged 07:43:04).
- **Why it's still a bug**: the assistant asks a yes/no question in natural
  language, in a chat, and then cannot understand "yes". That is a UX trap of
  the app's own making — the phrasing invites exactly the input the system
  rejects. It also reads as broken: in this session the coffee expense had
  *already* saved successfully at 07:42:37 via the button, so the user sees a
  confused denial immediately after a success.
- **Owner: Claude — `backend/ai/prompt.js`.** `docs/specs/01-ai-chat.md` §6
  says only "the client shows the drafts and asks the user to confirm"; it
  never mandates *how*, so no spec change is needed to fix this. The trap is
  created entirely by the reply wording the prompt tells the model to
  produce — a yes/no question — against an intent list (lines 10-19) that has
  no affirm/deny member to receive the answer. Both halves are in
  `prompt.js`, which is Claude's file.
- **Fix direction**: add an affirm/deny intent so a typed "yes" maps to the
  pending action (better product), or reword the prompt's replies to point at
  the button rather than ask a question (cheaper). Recommend the first — the
  app's premise is that the chat is the only way to change anything, so a
  chat that cannot accept "yes" contradicts it.
- **Not yet fixed.**

## Finding A — QA asserts that rows exist, not that their fields are right

Not an app bug — a gap in `qa/`'s own assertion rigor, recorded here because
it is why several bugs above reached a human first.

- **The pattern**: field-level assertion rigor was applied thoroughly to the
  auth surface and then abandoned for every collection the chat writes to.

  | Collection | Asserted | Not asserted |
  |---|---|---|
  | `users` (`01-signup.test.ts`) | exact key sets, every field value, cookie attributes, negative assertions | — genuinely thorough |
  | `expenses` (`06-chat-confirm.test.ts`) | `amount`; that a row with the returned `_id` exists; counts; summary totals | `store`, `description`, `date`, `category` values |
  | `categories` (`08-expenses-categories.test.ts`) | row counts (17), per-user isolation, ids | `name`, `parent`, `isProtected` values |
  | `messages` (`07-chat-messages.test.ts`) | `text`, `author` | full record shape, `createdAt` |

- **Concrete example**: `CC-02` ("create-expense with a single draft saves one
  expense") sends `{ amount: 12.5, store: "Aroma", category: "Food" }`, then
  asserts `amount` and `expenses.some(e => e._id === ...)`. It never checks
  that `store` came back `"Aroma"` or that `category` resolved to Food. The
  category count check is the starkest case: it would pass with 17 rows of
  garbage names.
- **Why it matters**: counts and ids prove the plumbing works. They say
  nothing about whether stored *values* are correct. Bugs 2 and 4 are both
  wrong-value bugs, which is precisely the class this style cannot see.
  Signup proves the exhaustive style is already understood — it just wasn't
  carried past auth.
- **Honest caveat**: field-level assertions alone would **not** have caught
  Bug 4. The confirm tests deliberately bypass the AI
  (`06-chat-confirm.test.ts:7` — "/chat/confirm never calls backend/ai/"), as
  does the e2e journey (`chat-dashboard-journey.spec.ts:57` — "deterministic,
  no AI"). So there are **two** distinct gaps: no field-level value
  assertions, and no test anywhere in which a real AI-produced draft reaches
  the save path.
- **Owner**: `qa/` is the `qa` subagent's responsibility
  (`.claude/rules/ownership.md`) — not for the main session to change. Left
  here as input for the next `qa` run, at Adam's discretion.
