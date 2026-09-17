# Flow analysis — the add-an-expense flow, before any inventory

Written first, as its own step, before re-reading `docs/reference/testing-reference/`
in depth or designing a single test. Required by the QA process ("think like a
user before you think like an engineer") and directly motivated by
`2026-09-16-chat-flow-bugs-and-fixes.md` — eleven bugs reached Adam by hand while
every existing automated test stayed green, because the suite tested endpoints
and rows, not the thing a person actually does with the app.

## The four questions

**1. What is this app for?**
It lets a person record what they spend, in their own words, and see where
their money is going. Not "an Express server with a React client" — a home
budget book that writes itself from a sentence.

**2. How is it meant to be used?**
Two screens. `/home` is a chat: the user types a sentence, the AI drafts a
change, the user confirms, and only then does anything touch the database.
`/dashboard` is read-only: it shows what the chat has recorded.

What the chat screen *is* — a chat — makes promises the spec never writes
down:
- The composer stays put at the bottom while messages scroll behind it (every
  chat app does this). **This was broken (bug 11) and is now fixed**
  (`e4130ae`, "Dock the chat composer").
- The assistant remembers what it just asked. A one-word answer to its own
  question ("bike", "yes", "50") should complete that turn, not restart a
  fresh, context-free parse. **This was broken (bug 8) and is now fixed** via
  `messageService`/`messageRepository` + `history` threaded into the prompt.
- If the assistant asks a yes/no question, "yes" should work. **This is still
  broken (bug 6) and is a known, open product decision** — verified below as
  current behaviour, not re-reported as a new failure.
- The dashboard promises that what you just recorded shows up on it. This was
  broken by the `getExpenseTotalByCategory` ObjectId bug and is **now fixed**
  (`qa/specs/e2e-chat-dashboard-journey.md` DJ-01, marked FIXED).

**3. How *can* it be used?**
Everything actually possible, not just the intended path:
- Answer a question with a bare word, out of order, or not at all.
- Type "yes" instead of clicking Confirm.
- Correct the assistant mid-draft, before confirming.
- Describe several expenses in one sentence.
- Name a category that does not exist yet.
- Name a category that nearly matches an existing one (near-miss vs.
  wrong-match — the two must be treated differently, per the bug-fix file's
  "wrong-category substitution" fix).
- Abandon a draft (Cancel, or just stop) and start over.
- Reload the page with a draft still pending.
- Log out and back in mid-conversation.
- Drive `/chat/confirm` directly with curl/Postman, skipping every guard the
  UI puts in front of it (this is exactly how bug 1 and bug 9 were found —
  the crash was always reachable from the real UI too, but the fastest way to
  pin it down was to hit the endpoint directly with the shape a client
  could actually send).

**4. What must never happen?**
- Nothing is saved without an explicit confirm.
- No expense is ever filed under a category the user did not actually agree
  to — not a nonexistent one (bug 10), not a silently-substituted near
  neighbour (the "Bike" → "Public transport" bug fixed the same day).
- No invented amount, no invented date (bug 4 — a same-day expense must store
  today, not a guess).
- A failed confirm must leave an honest record in the chat — not a silent
  "nothing happened" (bug 5).
- One user's data is never visible or editable by another (already covered
  by `CC-07`).
- No secret (password, bcrypt hash, Gemini key) ever reaches a response body
  or the client bundle (already covered elsewhere in `qa/`).

## The flows this drives

Named here, designed and automated below and in the accompanying spec files.

| # | Flow | Existing coverage before this run | What this run adds |
|---|---|---|---|
| 1 | Type an expense → AI drafts → confirm → stored → shows on dashboard (flagship) | `FJ-01`/`DJ-01` — one happy-path walk each | Field-level assertions added to the category-resolution spec (CR); flagship itself left as-is, see self-check |
| 2 | Missing required field, answered in a later turn (conversation memory) | none — every existing chat test is one message long | `FS-01` |
| 3 | User corrects a draft before confirming | none | `FS-02` |
| 4 | Several expenses in one message | unit/store-level only (`chatSlice`), never through a real AI call | `FS-03` |
| 5 | User names a category that doesn't exist yet | none through the real AI; prompt-level fix only asserted at the unit-prompt level | `FS-04` |
| 6 | Edit an existing expense via chat (search → match → confirm) | API-level only (`CC-04`/`CC-05`), no UI/AI path | **not added this run** — see self-check, named as an accepted gap |
| 7 | Delete an expense via chat, including "several matches, pick one" | API-level only (`CC-06`/`CC-07`) | **not added this run** — accepted gap |
| 8 | Reset categories to defaults (destructive, confirm-gated) | API-level only (`CC-11`) | **not added this run** — accepted gap |
| 9 | Cancel an in-flight draft | store-level unit test only | folded into `FS-01`/`FS-02` (both start a draft and never confirm the first one) |
| 10 | Reload mid-conversation | none | `FS-05` |
| 11 | Log out and back in mid-conversation | none | `FS-06` |
| 12 | Type "yes" instead of clicking Confirm | none — bug 6 is documented, not tested | `FS-07`, asserting the current (open) behaviour so a regression is caught, not asserting it as correct |
| 13 | Drive `/chat/confirm` directly, skipping the UI (missing/nonexistent/ambiguous category; a create-category subcategory whose `parent` must resolve to a real id) | `CC-01..CC-12` cover the happy paths and ownership, not the incomplete-input shapes that caused bugs 1/9/10 | `CR-01..CR-08` |

Flows 6-8 are real gaps, named plainly rather than silently skipped — see the
self-check in `qa/reports/latest.html` and the note at the end of
`qa/test-roadmap.md`.
