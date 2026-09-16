# The add-an-expense flow: four more bugs, and what got fixed

Companion to `2026-09-16-manual-bugs-found.md` (bugs 1-6, finding A), written
later the same day. That file recorded bugs found by using the app; this one
records what happened when we actually fixed bug 1 end to end, the four
further bugs that surfaced along the way, and — most usefully for `qa` — the
pattern in *why* every one of them slipped through automation.

Not a testable-surface inventory. Bug numbering continues from the companion
file.

## Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| `backend/bl/categoryService.js`, `backend/bl/expenseService.js`, `backend/bl/messageService.js` (new), `backend/dal/messageRepository.js` (new), `backend/routes/chatRoute.js`, `backend/ai/prompt.js`, `backend/ai/parseMessage.js`, `client/src/store/chatSlice.ts` | working tree at commit `6b31ea4` + uncommitted fixes | Found and fixed 2026-09-16 by manual end-to-end testing of "record an expense via chat". Fixes verified against the real database, not just HTTP status codes. |

## The headline: one user goal, five consecutive blockers

The user's goal was *add an expense*. Each fix revealed the next failure:

| Attempt | What the user saw | Cause |
|---|---|---|
| 1 | "Something went wrong." (500) | Bug 1 — `.toLowerCase()` on undefined |
| 2 | "Which category should this go under?" (400) | Bug 7 — Confirm offered on a category-less draft |
| 3 | "I didn't quite understand that" | Bug 8 — parser has no conversation memory |
| 4 | 500 on confirm | Bug 9 — category name vs ObjectId contract mismatch |
| 5 | "No category named Bike" (400) | Bug 10 — expense proposed against a nonexistent category |

Only after all five did an expense actually reach the database. **The lesson
for test design: asserting that a fix changed the error is not asserting that
the user can complete the task.** Every one of these was individually "fixed"
while the flow stayed broken. See `.claude/rules/product-first.md`, which was
extended this session with exactly this rule.

## Bug 7 — the client offered Confirm on a draft the AI said was incomplete

- **Symptom**: "paid 50" (no category stated) → AI replied asking which
  category, *and* the client rendered a confirm card reading
  "1. Expense — — ₪50.00" with an enabled Confirm button. Clicking it sent
  `category: undefined` to the server.
- **Root cause**: `client/src/store/chatSlice.ts`, `buildPending`. It guarded
  a missing `amount` but not a missing `category` — so a draft the AI itself
  described as incomplete still produced a pending action.
- **Fixed**: guard now covers both fields. Test added alongside the existing
  missing-amount test; watched it fail first.
- **Why QA missed it**: the client suite had a missing-amount case and no
  missing-category case. The invited-test list mirrored the implementation's
  blind spot instead of the spec's rule.

## Bug 8 — the parser had no memory of its own question

- **Symptom**: AI asked "what category does this belong to?", user answered
  "bike", AI replied "I didn't quite understand that." Same root cause as
  bug 6 ("yes" → `unknown`).
- **Root cause**: `chatRoute.js` called `parseMessage(text, categories,
  recent)` — current message only. Every turn was parsed in isolation, so a
  follow-up answer had no referent.
- **Fixed**: Adam refactored message access into `messageRepository` +
  `messageService` (the route had been querying the `Message` model directly,
  bypassing the `route → bl → dal → model` layering used everywhere else),
  then passed `getHistory(userId, 10)` as a 4th argument. `parseMessage` and
  `buildPrompt` now render that history, tagging the last entry `(current)`.
- **Why QA missed it**: no test exercises two related turns. Every chat test
  sends one message and asserts on one response. A conversation bug is
  invisible to a suite that never holds a conversation.

## Bug 9 — `createCategory` took a name where it expected an ObjectId

- **Symptom**: confirming "create the subcategory Bike under Transport" →
  500, `CastError: Cast to ObjectId failed for value "Transport"`.
- **Root cause**: `categoryService.createCategory` called
  `findCategoryById(parent)`, but the AI's schema defines `parent` as
  *"A main category name, or null"*. A contract mismatch between
  `backend/ai/` (sends names) and `backend/bl/` (expected ids) — the two
  halves were each internally consistent and disagreed with each other.
- **Fixed**: `createCategory` now resolves the parent name via `findByName`,
  handles zero/ambiguous matches with 400s, and stores the resolved `_id`.
  Verified in MongoDB that `parent` holds a real ObjectId, not the string.
- **Why QA missed it**: `06-chat-confirm.test.ts` hand-writes its confirm
  payloads, and its `create-category` case (`CC-08`) creates a *main*
  category with no parent — so the name→id path never ran. The one shape that
  crashes was the one shape untested.

## Bug 10 — the AI proposed an expense under a category that doesn't exist

- **Symptom**: AI offered "save this expense of 50 under Transport → Bike"
  before Bike existed. Confirming gave 400 `No category named "Bike"`. The
  user had to create the category manually and redo the whole expense.
- **Root cause**: nothing in `prompt.js` forbade drafting against a category
  absent from the user's list.
- **Partially fixed**: prompt now forbids it — the model must use
  `create-category` or ask instead. **The deeper hole is still open**: there
  is no way to create a category and save an expense under it in one
  confirmation, which is what the user actually wanted. That needs a spec
  change (`docs/specs/01-ai-chat.md`) and likely a client change. Not done.

## Bug 11 — the message input scrolls away with the conversation

- **Symptom**: the "Write it the way you would say it." input and Send button
  sit at the end of the message list rather than being fixed to the bottom of
  the viewport. Once the conversation is longer than the screen, the user has
  to scroll down to type — every time.
- **Expected**: the convention every chat app follows, and what Adam asked
  for by name (Claude's own app as the reference): the composer is docked to
  the bottom of the viewport and stays there while the messages scroll behind
  it. Optional refinement he described: with zero messages the composer sits
  centred in the empty space, then docks to the bottom once the first message
  is sent.
- **Owner**: Claude — `client/src/components/HomePage.tsx` and its styles.
- **Why QA missed it**: it is a layout property, not a behaviour — no
  assertion about DOM state or API response can see it. This is the category
  of defect that only a human looking at the screen, or a visual/screenshot
  test, will ever catch. Worth noting as a limit of the current suite rather
  than a gap to close with more unit tests.
- **Not yet fixed** — documented only, at Adam's instruction.

## Also fixed this session

- **Bug 1** — `resolveCategory` now rejects a missing category name with a
  400 before `findByName` can crash. Server-side only; the full user-facing
  fix required bugs 7-10 as well.
- **Bug 4** (wrong dates) — `prompt.js` never told the model what day it was,
  so it guessed: three expenses recorded on 2026-09-16 were stored as
  2026-03-31, 2026-06-06 and 2026-05-16, making all of them invisible on the
  dashboard's Today and This month views. `buildPrompt` now takes a `today`
  argument (injectable for tests, defaults to the real clock) and states the
  date in the rules. **This is the one bug here with a genuinely
  deterministic assertion available, and it had none.**
- **Wrong-category substitution** — "Bike" was silently filed under
  "Public transport". Prompt now forbids substituting a non-matching
  category; near-misses like "Transportation" → "Transport" are allowed but
  must be named in the reply so the user can catch a bad match.
- **Ignored corrections** — the user wrote "I said under Transportation" and
  got the identical previous reply back, verbatim. Prompt now requires
  acknowledging a correction and never repeating a prior reply unchanged.

## What `qa` should take from this

Ordered by how much coverage they'd have bought:

1. **Test the user's goal, not the endpoint.** Not one test in the suite
   drives *record an expense from a plain-language message through to a row
   in the database*. Bugs 1 and 7-10 all sit on that path; each is invisible
   to a test that starts at `/chat/confirm` with a hand-written payload.
2. **Assert stored values, not just status codes and row counts.** Bug 4
   would have been caught by a single assertion that a same-day expense
   stores today's date. See finding A in the companion file — this is the
   same gap, now with a concrete cost attached.
3. **Hold a conversation.** Bugs 6 and 8 are both multi-turn. A suite where
   every test is one message long cannot see them.
4. **Exercise the AI→server contract.** `06-chat-confirm.test.ts:7` notes it
   deliberately bypasses `backend/ai/`, and the e2e journey does the same
   ("deterministic, no AI"). That determinism is reasonable, but it means
   nothing verifies that what the AI actually emits is what the services
   actually accept — which is precisely bug 9. A contract test over the
   draft/confirm payload shapes would cover it without needing a live model.
5. **Cover the incomplete-input shapes.** Missing category, missing amount,
   nonexistent category, ambiguous name. Every test payload in the suite is
   complete and valid; four of today's bugs needed an incomplete one.
