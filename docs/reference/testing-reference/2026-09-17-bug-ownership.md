# Who fixes what, from the automated run findings

Not a testable-surface inventory. This assigns each bug in
`2026-09-17-automated-run-findings.md` to the layer that owns its fix, per
`.claude/rules/ownership.md`. Written before any fix, so the split is decided
once and not re-litigated bug by bug.

## Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| The "eight to fix first" in `2026-09-17-automated-run-findings.md`, plus the lower-severity bugs listed there | commit `e4130ae` | Traced by reading `backend/ai/prompt.js`, `backend/ai/schema.js`, `backend/routes/chatRoute.js`, `backend/bl/userService.js`, `backend/bl/expenseService.js`, `backend/models/expenseModel.js`, `client/src/store/chatSlice.ts`, `client/src/App.tsx`, `client/src/main.tsx` |

## The eight, by owner

| # | Bug | Root cause | Owner |
|---|---|---|---|
| 1 | App claims an expense was saved when nothing was written | The model's `reply` text asserts success on a plain-text "yes" with no confirm ever sent | **Claude** — `backend/ai/prompt.js` |
| 2 | A correction ("actually it was 22") is acknowledged in prose, dropped from the payload | Model doesn't reliably re-emit the corrected draft | **Claude** — `backend/ai/prompt.js` |
| 3 | Negative amount silently flipped positive; `12.345` accepted | No sign handling in the prompt, no precision limit in the schema | **Claude** — `backend/ai/prompt.js`, `backend/ai/schema.js` |
| 4 | Reloading the page can log you out | `/users/refresh` rotates the token with no tolerance for two concurrent calls (StrictMode double-mounts `restoreSession` in dev, which is ordinary React behaviour, not itself the bug) | **Adam** — `backend/bl/userService.js` |
| 5 | A draft the app can't read is dropped with no Confirm button and no explanation | Model leaks its own deliberation into `store`/`description`; server logs it but the client shows nothing when the draft is discarded | **Claude** — `backend/ai/prompt.js` (stop the leak) and `client/src/store/chatSlice.ts` (tell the user instead of silently dropping) |
| 6 | An empty chat message returns a 500 | `req.body.text` reaches `parseMessage` with no validation | **Adam** — `backend/routes/chatRoute.js` |
| 7 | An expense can be saved with no store and no description | Both fields are optional on the model with no "at least one" rule | **Adam** — `backend/models/expenseModel.js` (and/or `backend/bl/expenseService.js`) |
| 8 | The app offers to edit an expense that doesn't exist | Model asserts a match in `reply` before real `searchFilters` matches are known | **Claude** — `backend/ai/prompt.js` |

## Lower-severity, by owner

| Bug | Owner |
|---|---|
| FR-39 — signup error text ("must between") | **Adam** — `backend/routes/userRoute.js` |
| FR-42 — user not told the dashboard can total spending | **Claude** — `backend/ai/prompt.js` |
| LV-15 — dashboard overflow at phone width | **Claude** — `client/` |
| FR-38 — nav link tap targets under 44×44px | **Claude** — `client/` |
| FR-43 — Hebrew message gets an English reply | **Claude** — `backend/ai/prompt.js` |

## What this means for fixing order

Claude can start on 1, 2, 3, 5 (the prompt half), and 8 directly —
all `backend/ai/prompt.js` / `schema.js`, no dependency on Adam's code.

4, 6, 7 need Adam to write the fix himself (`backend/bl/userService.js`,
`backend/routes/chatRoute.js`, `backend/models/expenseModel.js` respectively).
Claude's role there is explaining the bug and the shape of the fix, not
writing it.

5's client half (tell the user the draft was dropped, instead of silence) is
`client/` — Claude's, but only makes full sense once the prompt fix reduces
how often it fires.
