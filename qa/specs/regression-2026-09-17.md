# Test spec — regressions for the thirteen unverified fixes

**IDs:** `RG-01` … `RG-31`.
**Source:** `docs/reference/testing-reference/2026-09-17-automated-run-findings.md`
(the eight severe bugs) plus FR-39, FR-42, FR-43, LV-15, FR-38.
**Ownership:** all thirteen fixes are in the tree; none has been through a run.

**The bar for every case here:** it must **fail if the fix is reverted**. A
case that passes either way is worth nothing in this file, so each one names
the line it is pinned to. Where a fix cannot be pinned deterministically —
because it lives in a prompt — the case says so and is designed as a rate, not
a yes/no. See §2.

---

## 1. How the AI-layer cases are designed, and why

Five of the thirteen (bugs 1, 2, 3, 5, 8, plus FR-42 and FR-43) were fixed by
**adding sentences to `backend/ai/prompt.js`**. That is not the same kind of
fix as a guard in a function, and testing it the same way produces a suite
that is green or red by luck.

Two consequences, applied throughout:

**Every prompt case runs N times and passes on a rate, not on one result.**
N = 5 unless stated. A single run of a probabilistic system is an anecdote.
The rate is stated per case and is deliberately below 100% where the only
mechanism is an instruction — claiming 100% from a model instruction would be
claiming something the design cannot deliver.

**Every prompt case is paired with a deterministic invariant, where one
exists.** The rate case says "the model usually does the right thing"; the
invariant says "and when it does not, the user is still safe". The invariant
is the half that protects anybody, and it is the half that must be 100%.

Where the invariant does **not** exist, that is a finding in itself and is
recorded as one — see `RG-06`.

---

## 2. Bug 3 — sign and precision

The fix is `backend/ai/prompt.js` lines ~140–151. There is **no schema
constraint**: `backend/ai/schema.js` declares `amount: { type: Type.NUMBER }`
and Gemini's `Type.NUMBER` has no `multipleOf`, so nothing structurally
prevents a negative or over-precise amount being emitted. It is a model
instruction and it is fallible.

### RG-01 — a negative amount is not silently flipped positive
- **Purpose:** the prompt's "Never turn a negative amount into a positive one"
  rule.
- **Under test:** `backend/ai/prompt.js`.
- **Method:** fresh account. Send each of these through the **real UI**, 5
  repetitions each, a fresh conversation per repetition:
  `spent -50 on coffee` · `-32.5 for gas` · `minus 20 at the shop` ·
  `I spent -1200 on rent`.
- **Expected:** in **≥ 4 of 5** repetitions per phrasing, the reply does *not*
  offer a positive amount for confirmation. Acceptable outcomes: intent
  `unknown` with a question about whether they meant a positive amount, or an
  explicit refusal. Unacceptable: a draft card showing `50`, `32.5`, `20` or
  `1200`.
- **Environment:** fresh.
- **Fails if reverted:** yes — before the fix, `spent -50 on coffee` produced
  *"I've noted 50 under Food → Coffee. Would you like me to save this
  expense?"*, confirmed from the raw AI response.

### RG-02 — a negative amount can never reach the database (invariant)
- **Purpose:** the deterministic half of `RG-01`.
- **Under test:** `backend/models/expenseModel.js` `amount: { min: 0.01 }`.
- **Method:** API level, bypassing the model entirely. `POST /chat/confirm`
  with a `create-expense` draft of `-50`, and again with `0`, and again with
  `-0.01`.
- **Expected:** 400 in every case, error-contract shape, and **no expense
  document created** — asserted by counting the user's expenses before and
  after.
- **Environment:** fresh.
- **Rate:** 100%. This one is deterministic and must never fail.

### RG-03 — an over-precise amount is not accepted
- **Purpose:** the prompt's "at most two decimal places" rule.
- **Method:** as `RG-01`. Phrasings: `12.345 on snacks` ·
  `spent 7.8912 at the kiosk` · `19.999 for parking`.
- **Expected:** in **≥ 4 of 5** repetitions, intent `unknown` and a request to
  confirm the amount. The model must **not** round it itself — a draft showing
  `12.35` fails this case just as a draft showing `12.345` does. That
  distinction is the point of the rule: silently rounding is how a user
  confirms a number they did not type.
- **Environment:** fresh.

### RG-04 — an over-precise amount reaching the server is refused (invariant)
- **Method:** `POST /chat/confirm` directly with amounts `12.345`, `7.8912`,
  `0.005`.
- **Expected:** 400, no document created.
- **Environment:** fresh.
- **Status:** **expected to FAIL, and this is a real gap, not a test bug.**
  `expenseModel.amount` has `min: 0.01` and nothing else; `expenseService`
  applies no precision check. `12.345` is a valid Number above 0.01 and will
  be stored. The 2026-09-17 findings already recorded "an amount of `12.345`
  is accepted rather than refused" at the API layer, and that is still true.
- **⚠ Blocker — Adam's code.** The backstop belongs in
  `backend/models/expenseModel.js` or `backend/bl/expenseService.js`, both of
  which are Adam's. I have not written it and have not sketched it. Reported
  in the final message.
- **Why it matters more than it looks:** once `12.345` is stored, every total
  is computed from it while every screen prints a rounded version, so the
  dashboard's rows stop summing to its own total. Nothing crashes. This is the
  wrong-value class exactly.

---

## 3. The other four severe AI-layer bugs

### RG-05 — the app never claims to have saved something it did not save
- **Purpose:** bug 1, the findings' number one — "the user believes their
  budget is recorded. It is not, and nothing on screen ever tells them."
- **Under test:** `backend/ai/prompt.js`.
- **Method:** fresh account. Through the real UI: send `spent 22 at Aroma`,
  wait for the draft, then reply `yes` **as a typed message** rather than
  pressing Confirm. 5 repetitions.
- **Expected, in all 5:** the assistant's reply does not assert that anything
  was saved. **And the invariant, at 100%:** the user's expense count is
  unchanged, read from the database.
- **Environment:** fresh.
- **Fails if reverted:** yes — the reported reply was *"I have saved your 22
  expense at Aroma"* with no expense anywhere.
- **Note:** the findings record that typing "yes" instead of pressing Confirm
  is a **known open product decision**, not itself a bug. This case does not
  re-litigate that. It asserts only that whatever the app does, it does not
  lie about it.

### RG-06 — a correction before confirming is carried into what is saved
- **Purpose:** bug 2 — "acknowledged in prose and dropped in the payload".
- **Method:** fresh account, real UI. `spent 18 on lunch` → wait for the
  draft → `actually it was 22` → wait → press **Confirm**. 5 repetitions.
  Repeat with: `50 at the supermarket` → `no, 45` → Confirm; and
  `20 for coffee` → `make it 20.50` → Confirm.
- **Expected:** in **≥ 4 of 5**, the stored expense's `amount` is the
  corrected value — 22, 45, 20.50 — read from the database, not from the
  reply text. The reply agreeing with the correction while the row holds the
  original is the exact failure and must be reported as such.
- **Environment:** fresh.
- **Fails if reverted:** yes — the reported behaviour stored **18**.
- **Design note:** this case walks the real producer end to end. It does not
  post a hand-written payload, because the whole defect lives in what the
  upstream produces, and a case that starts at `/chat/confirm` cannot see it.

### RG-07 — an unreadable draft tells the user something
- **Purpose:** bug 5 — the dead end. The model leaks its deliberation into
  `store`, the server's guard catches it, and the client drops the draft in
  silence, leaving *"want me to add this?"* with no Confirm to press.
- **Under test:** `client/src/store/chatSlice.ts` (the client half) and
  `backend/ai/prompt.js` (the leak).
- **Method:** component level, deterministic — do **not** wait for the model to
  misbehave. Feed `chatSlice` a `/chat/messages` reply whose draft has
  `store: "let's use description… Wait, let's use store… Wait, rule-abiding…"`
  (the real string from the logs), and variants: a `<script>` fragment, a JSON
  blob, a 3000-character run of one repeated word.
- **Expected:** in every case the user is told, in the transcript, that the
  draft could not be read and to rephrase — `HomePage.test.tsx` already
  asserts a `role="alert"` for one of these. No silent drop: the transcript
  must never end on a question with neither a Confirm control nor an
  explanation.
- **Environment:** none.
- **Why deterministic and not end-to-end:** the findings note six further
  instances of this defect were nearly filed as "run artefacts" because the
  model's misbehaviour is intermittent. Pinning the *client's response to bad
  input* removes the model from the loop entirely, and it is the client's
  response that determines whether the user is stranded.
- **Blocker, carried forward:** `FR-05`'s unit half still needs `buildPending`
  exported from `client/src/store/chatSlice.ts`. That is `client/` — Claude's,
  not Adam's — so it is a normal change, not an ownership blocker. Flagged so
  it is not mistaken for one again.

### RG-08 — no phantom match on an account with nothing to match
- **Purpose:** bug 8 / `BD-01` — *"change the coffee expense to 30"* on an
  empty account got *"Would you like me to update the coffee expense…"*.
- **Method:** fresh account, **zero expenses**, real UI. Send, 5 repetitions
  each: `change the coffee expense to 30` · `delete the rent expense` ·
  `change yesterday's groceries to 80`.
- **Expected:** in **≥ 4 of 5** per phrasing, the reply says plainly that no
  such expense exists. No draft card. No Confirm control. **Invariant at
  100%:** no expense is created or modified.
- **Environment:** fresh.
- **And the sibling nobody has exercised:** repeat `delete the coffee expense
  from this morning` on `lv_coffee`, which holds 40 near-identical coffees
  **none of which is from this morning**. The account is full, the specific
  match is absent — the case where a false match is most tempting and least
  visible. Expected: a refusal or a disambiguation prompt, never a silent pick
  of the most recent one.
- **Environment (second half):** lived-in (`lv_coffee`).

---

## 4. Adam's three severe fixes

### RG-09 — a reload does not log you out
- **Purpose:** bug 4, "one bug, four symptoms". `/users/refresh` rotates the
  token; two concurrent calls used to make the loser's 401 log out a user who
  had just logged in.
- **Under test:** `backend/bl/userService.js` — `jti`, `replacedAt`,
  `RACE_GRACE_MS`.
- **Method:** browser. Log in, then reload **10 times in a row**, asserting
  after each that the session survived.
- **Expected:** logged in after all 10.
- **Environment:** fresh.
- **Why 10:** the original `UJ-01` asserted the session survived one reload
  and **passed while reloading by hand logged you out** — the race simply fell
  the other way that time. One repetition of a race is not a test of it.
- **Read the constant from source.** `RACE_GRACE_MS` is `3 * 1000` today.
  `qa/harness/env.ts` already exposes `readRaceGraceMs()`; use it. Never
  hardcode 3000 — Adam may tune it, and per `bug-flow.md` §3 a test that
  hardcodes a constant the fix depends on breaks the next time he does.

### RG-10 — two concurrent refreshes both succeed inside the grace window
- **Purpose:** the mechanism under `RG-09`, directly.
- **Method:** API. Log in, then fire two `POST /users/refresh` with the same
  cookie **simultaneously**.
- **Expected:** both return 200. Net refresh-token row growth across the pair
  is zero or one, never negative. The user is still able to call a protected
  route afterwards.
- **Environment:** fresh.

### RG-11 — a rotated token dies once the grace window closes
- **Purpose:** the property round 3 of the fix traded for the race tolerance —
  `bug-flow.md` records the window as a deliberate replay gap Adam owns.
- **Method:** log in, refresh once, wait `readRaceGraceMs() + 1000`, then
  replay the **old** cookie.
- **Expected:** 401.
- **Environment:** fresh.
- **Note:** this is the case that stops `RG-09`'s fix being "widened until the
  race goes away". If someone raises `RACE_GRACE_MS` to 7 days, `RG-09` and
  `RG-10` both still pass and this one fails. That is the point.

### RG-12 — an empty chat message is refused, not a 500
- **Purpose:** bug 6.
- **Under test:** `backend/routes/chatRoute.js` —
  `body("text").trim().notEmpty()`.
- **Method:** `POST /chat/messages` with `text` as: `""`, `"   "`, `"\n\t"`,
  omitted entirely, `null`, `123`, an empty array, an object.
- **Expected:** 400 in every case, with the `{ errors: [{ field, message }] }`
  shape and `field === "text"`. Never 500. Assert `backend/logs/error.log`
  gains no line — a deliberate 4xx must not be logged as a server error
  (spec 07 §4).
- **Environment:** fresh.
- **Fails if reverted:** yes — removing the validator returns `text` as
  `undefined` to `parseMessage` and throws.
- **And through the UI:** press Send with the composer empty, and with only
  spaces. Expected: nothing is sent at all, or a clear message — never an
  error banner from a 500.

### RG-13 — an expense cannot be saved with no label
- **Purpose:** bug 7 — "a blank row on the dashboard, permanently, with nothing
  to identify it".
- **Under test:** `backend/bl/expenseService.js:41` —
  `throw { status: 400, message: "An expense needs a store or a description." }`.
- **Method:** `POST /chat/confirm`, `create-expense`, with: neither `store`
  nor `description`; both present but empty strings; both present but
  whitespace only; `store: null, description: null`.
- **Expected:** 400 in all four, no document created.
- **Environment:** fresh.
- **Fails if reverted:** yes — both fields are plain optional `String` on the
  model, so without the service guard all four write a row.
- **Whitespace note:** the empty-string and whitespace variants are the ones
  most likely to slip through a `if (!store && !description)` check, since
  `""` is falsy but `" "` is not. If those two fail and the first two pass,
  report it as a live gap rather than as this case passing.

---

## 5. The five lower-severity fixes

### RG-14 — the signup error text matches spec 03
- **Purpose:** FR-39. Was *"User name must between 3 and 20 characters"* — a
  missing word and a field name that does not match its own label.
- **Under test:** `backend/routes/userRoute.js`.
- **Method:** `POST /users/signup` with a 2-character username.
- **Expected:** 400, `{ errors: [{ field: "username", message: "Username must
  be 3–20 characters." }] }`.
- **Environment:** fresh.
- **⚠ Implementer, read this.** The message contains an **en dash** (`–`,
  U+2013) between 3 and 20, **not** a hyphen. Copy it from
  `backend/routes/userRoute.js`, do not retype it. Better: assert against the
  string read from spec 03, not a literal in the test.
- **And per the testable-surface file's closing warning:** RA-06 and XC-11 were
  reverted to spec wording, and the divergence table in `qa/specs/README.md`
  had both stated backwards. Any case deriving expected wording reads
  `docs/specs/`, never that table.

### RG-15 — a duplicate username names the username
- **Purpose:** EH-05, first of three shapes.
- **Under test:** `backend/error_handling.js` —
  `const field = Object.keys(err.keyValue ?? {})[0] ?? "That value"`.
- **Method:** sign up, then sign up again with the same username and a
  different email.
- **Expected:** 409, body exactly `{ error: "username already exists." }`.
- **Environment:** fresh.
- **Fails if reverted:** yes — the previous body was the fixed string
  *"That username or email is already taken."* for both shapes.

### RG-16 — a duplicate email names the email
- **Method:** sign up, then again with the same email and a different
  username.
- **Expected:** 409, `{ error: "email already exists." }`.
- **Environment:** fresh.
- **Why both:** `RG-15` alone passes against a hardcoded `"username already
  exists."`. Only the pair proves the field is derived from `err.keyValue`.

### RG-17 — a duplicate-key error with no `keyValue` falls back safely
- **Purpose:** the third shape, and the one no real request produces — which is
  why it needs a unit case.
- **Under test:** `error_handling.js`'s `?? {}` and `?? "That value"`.
- **Method:** unit. Call `errorHandler` directly with `{ code: 11000 }` and no
  `keyValue`; then with `{ code: 11000, keyValue: {} }`; then with
  `{ code: 11000, keyValue: { username: "a", email: "b" } }`.
- **Expected:** `"That value already exists."` for the first two. For the
  third, a 409 naming the **first** key, without throwing.
- **Environment:** none.
- **Why it is worth a case:** `Object.keys(undefined)` throws. The `?? {}` is
  the only thing between a duplicate-key error with an unusual shape and a 500
  from inside the error handler itself — which would be logged as a server
  error and would lose the original error entirely.

### RG-18 — a totals question points at the dashboard
- **Purpose:** FR-42.
- **Under test:** `backend/ai/prompt.js`, the totals-question rule.
- **Method:** real UI, 5 repetitions each:
  `how much did I spend on food this month` ·
  `how much have I spent overall` · `what's my total for September`.
- **Expected:** in **≥ 4 of 5**, intent `unknown`, the reply says it cannot
  total spending here **and mentions the dashboard**, and it never claims it
  can answer. **Invariant at 100%:** nothing is created, edited or deleted.
- **Environment:** lived-in (`lv_steady`) — a totals question on an empty
  account is not the situation a user asks it in, and a model with real
  category context may behave differently from one with none.
- **Scope guard:** this is the V1 stopgap only. `prompt.js`'s own comment says
  the rule is removed when V2's `answer-question` intent ships. When that
  happens this case is deleted, not adjusted — V2 is
  `v2-chat-questions-2026-09-17.md`'s, and is out of scope here.

### RG-19 — a Hebrew message gets a Hebrew reply
- **Purpose:** FR-43.
- **Method:** real UI, 5 repetitions each, on a Hebrew message that creates an
  expense, one that asks a question, and one that is not understood.
- **Expected:** in **≥ 4 of 5**, the `reply` is in Hebrew.
- **And the half the rule exists to protect:** the structured fields must be
  **unaffected** — an existing category matched by a Hebrew message still
  carries that category's own English name, not a translation of it. Assert
  the stored `category` resolves to a real category id owned by that user, and
  that no category was created as a side effect.
- **Environment:** fresh, and once on `lv_sprawl` where 32 categories make a
  wrong match more likely.
- **⚠ Provisional bar.** The findings record FR-43 as "**provisional bar,
  unconfirmed**". Adam has not confirmed that Hebrew replies are required. If
  he says they are not, delete this case rather than weakening it.

### RG-20 — no horizontal overflow at phone width, anywhere
- **Purpose:** LV-15. **Filed as "the dashboard overflows once a category is
  expanded". That is wrong** — see `qa/field-notes-2026-09-17-exploratory.md`
  §6. Measured on the current tree: the overflow was the **navbar**, it
  appeared on `/home` too, and expanding a category changed nothing. This case
  is written against what is true.
- **Under test:** `client/src/index.css`, the below-480px navbar wrap.
- **Method:** at 375 px and at 320 px, on **`/login`, `/signup`, `/home`,
  `/dashboard`, `/how-to-use`** and in **both auth states**, assert:
  (a) `document.documentElement.scrollWidth === clientWidth`; **and**
  (b) every element's `getBoundingClientRect().right <= clientWidth + 0.5`.
  On `/dashboard`, run it twice — all categories collapsed, then all expanded
  — to record that the expansion makes no difference, rather than leaving the
  original report's claim untested.
- **Expected:** both hold everywhere.
- **Environment:** none for the public routes, fresh for `/home`, lived-in
  (`lv_sprawl`, 32 categories) for `/dashboard`.
- **Status:** (a) passes on all of them today. (b) **fails on `/dashboard`** —
  the Recent-expenses table reaches 384 px inside its own `overflow-x`
  scroller. A suite carrying only (a) reports that route clean, which is why
  both halves are required.
- **Fails if reverted:** yes for (a) — removing the wrap rule restores the
  navbar overflow at 375 px with five items.

### RG-21 — nav tap targets are at least 44×44 with 6px between them
- **Purpose:** FR-38. Measured before the fix: "Log in" 40×23, "Sign up"
  79×36.
- **Method:** at 375 px, in both auth states, measure every navbar link and
  button, and the gaps between adjacent ones.
- **Expected:** each ≥ 44×44; each adjacent gap ≥ 6 px.
- **Environment:** none, then fresh.
- **⚠ Provisional bar.** The findings record FR-38's 44×44 as "**provisional
  bar, unconfirmed**". It is the standard mobile target size and I would keep
  it, but it is Adam's to confirm.
- **Extend to the Replay buttons:** spec 12 §6 applies the same bar to them.
  That is `HT-10`; noted here so the two are changed together if the number
  changes.

---

## 6. The fixes' blast radius — what a revert would also break

Each of these exists because `bug-flow.md` §3 requires the checks expected to
**pass unchanged** to be listed too: a fix that breaks a neighbour is the
commonest way a bug moves instead of closing.

### RG-22 — the ordinary create-expense flow still works
- **Method:** fresh account, real UI, `spent 50 at the supermarket and 32.5 on
  gas`, Confirm.
- **Expected:** two expenses stored. **Every field checked, supplied and
  derived:** `amount` 50 and 32.5; a label matching what was said; `category`
  resolving to real category ids owned by that user, named Groceries and Fuel;
  `date` equal to today at UTC midnight; `user` equal to the signed-up user.
- **Environment:** fresh.
- **Note:** this replaces `FJ-01` as the covering case for that flow and
  demotes `FJ-01` to a sample. `FJ-01` asserts the reply and a row count.

### RG-23 — the prompt additions did not break the other six intents
- **Purpose:** FR-42 and FR-43 added rules to a shared prompt. Every intent
  reads that prompt.
- **Method:** real UI, one representative sentence per intent — create
  expense, edit expense, delete expense, create category, edit category,
  delete category, reset categories — 3 repetitions each.
- **Expected:** the intended intent in ≥ 2 of 3, and no sentence is
  misclassified as `unknown` by the new totals rule. In particular
  `reset my categories to the defaults` must not be read as a totals question.
- **Environment:** lived-in (`lv_steady`).

### RG-24 — `helmet()` is first, and nothing else moved
- **Purpose:** XC-13. `backend/index.js` now mounts `helmet()` before
  `compression()`, per spec 07 §2.
- **Method:** assert the helmet headers are present on every response —
  including a 404, a 400, a 500 and a compressed response — and that responses
  are still gzipped.
- **Expected:** both.
- **Environment:** fresh.
- **Note:** `qa/specs/README.md`'s divergence table listed this backwards
  before today. Derive from `docs/specs/07-server-entry.md` §2.

### RG-25 — the error-response contract still has exactly two shapes
- **Purpose:** EH-05 changed a 409 body. The client understands two shapes; a
  third shows a generic error and breaks field mapping.
- **Method:** provoke every error path reachable from the API — 400 validation,
  400 thrown, 401, 403, 404, 409, 429, 500 — and validate each body against
  the zod schemas in `qa/fixtures/schemas.ts`.
- **Expected:** every body is exactly `{ error }` or
  `{ errors: [{ field, message }] }`. For the validation shape, `field`
  matches a key of the request body.
- **Environment:** fresh.

### RG-26 — no secret leaves the server, still
- **Method:** across every endpoint exercised in this file, assert no response
  body contains `password`, a bcrypt prefix (`$2a$`/`$2b$`), `refreshToken`,
  or anything matching a Gemini key. Assert the same of the built client
  bundle.
- **Expected:** none.
- **Environment:** fresh.
- **Why here:** `error_handling.js` was edited this round, and it is the module
  that decides what an error body contains. `safeBody` redacts `password` for
  the **log**; this case is about the response.

---

## 7. Observability — can a failure be reconstructed?

The findings say the investigation into the 207 KB response was possible only
because `backend/logs/ai.log` happened to hold the raw text. Nothing tests
that it keeps doing so, and observability is invisible from the user's seat.

### RG-27 — a failed AI parse leaves enough behind to diagnose it
- **Method:** drive a parse failure (the `RG-07` inputs, at the server layer).
  Read `backend/logs/ai.log`.
- **Expected:** the log line carries the raw model response, or a bounded
  prefix of it, plus the intent and the user id — enough to reconstruct what
  the model actually returned. A line carrying only a status code and a
  response size is a fail.

### RG-28 — and leaves behind nothing it should not
- **Method:** across every log file after a full run of this spec, grep for
  the signup password, a bcrypt hash, a refresh token, and the Gemini key.
- **Expected:** no matches. `safeBody` redacts `password` from the error
  handler's log lines; this asserts it, and covers the other three which it
  does not touch.
- **Note:** these two cases are a pair and must stay one. "Log more" and "log
  less" pull against each other, and a change that satisfies one while
  breaking the other is the likely outcome if they are split.

### RG-29 — log separation survives the error-handler change
- **Method:** provoke a 500, a deliberate 4xx, and an `{ area: "ai" }` line.
- **Expected:** the 500 reaches `error.log` **and** `app.log`; the 4xx reaches
  `app.log` only; the ai line reaches `ai.log`. Specifically the new 409 path
  logs at `warn` and must not appear in `error.log`.
- **Environment:** fresh.

### RG-30 — the AI layer has a response-size ceiling
- **Purpose:** the findings: "`backend/ai/` has **no output-length cap and no
  repetition guard**. A 207 KB response from a budget-app parse is a wasted API
  call and a dead-ended user."
- **Method:** static + unit. Assert `backend/ai/` applies a maximum output
  length, and that `parseMessage` rejects a response above it with a message
  the user can act on rather than attempting to parse it.
- **Expected:** it does.
- **Status:** **expected to FAIL — no such cap exists.**
- **⚠ Proposed bar, Adam to confirm:** **8 KB**. A parse result for one
  sentence is a few hundred bytes; 8 KB is an order of magnitude of headroom
  and still three orders below 207 KB. `backend/ai/` is Claude's, so this is
  fixable without Adam writing code — but the number is his.

### RG-31 — the same expense reads the same in the chat and on the dashboard
- **Purpose:** the seam class, at the layer the user sees. Detailed in
  `qa/specs/client-shared-components.md` §2: there are two money formatters and
  they disagree.
- **Method:** fresh account, real UI. Create an expense of `1234.5` through the
  chat. Read the amount as printed on the confirm card; confirm; read the
  amount as printed in the dashboard's Recent-expenses row and in its category
  breakdown.
- **Expected:** all three strings identical.
- **Environment:** fresh.
- **Status:** **expected to FAIL** — `₪1234.50` on the card, `₪ 1,234.50` on
  the dashboard.

---

## 8. Coverage, and what is not here

| Fix | Rate case | Deterministic invariant |
|---|---|---|
| Bug 1 | RG-05 | RG-05's count check |
| Bug 2 | RG-06 | — **none exists** |
| Bug 3 | RG-01, RG-03 | RG-02 ✓ · RG-04 ✗ **gap** |
| Bug 4 | — | RG-09, RG-10, RG-11 |
| Bug 5 | — | RG-07 |
| Bug 6 | — | RG-12 |
| Bug 7 | — | RG-13 |
| Bug 8 | RG-08 | RG-08's no-write check |
| FR-39 | — | RG-14 |
| FR-42 | RG-18 | RG-18's no-write check |
| FR-43 | RG-19 | RG-19's category-id check |
| LV-15 | — | RG-20 |
| FR-38 | — | RG-21 |
| EH-05 | — | RG-15, RG-16, RG-17 |

**Bug 2 has no deterministic backstop and cannot have one.** Whether a
correction was carried into the payload is a question only the model's output
answers; there is no invariant the server could check, because both 18 and 22
are valid amounts. `RG-06` is therefore the weakest case in this file, and it
guards the second-most-damaging bug on the list. **Not covered, and the reason
is a real risk judgement:** acceptable today only because `RG-06` walks the
real producer at 5 repetitions across 3 phrasings, which is the most that can
be claimed. It should be re-run on every prompt change, and a prompt change
that drops its rate is a regression even if every other case is green.

**`RG-04`'s gap is not accepted.** It is a live hole with an owner
(`backend/`, Adam's) and it is in the final report as a blocker.
