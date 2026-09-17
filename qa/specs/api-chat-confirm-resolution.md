# Test spec — `POST /chat/confirm` category resolution and the audit trail (API)

**Under test:** `backend/bl/expenseService.js`'s private `resolveCategory`
(reached via `createExpense`/`createManyExpenses`/`editExpense`),
`backend/bl/categoryService.js`'s `createCategory`'s name→id resolution of
`parent`, and `backend/routes/chatRoute.js`'s persistence of the confirm
outcome (success and failure) to the `messages` collection.

**Governing spec:** `docs/specs/09-expense-category-service.md` §2-§4;
`docs/specs/01-ai-chat.md` §6 (confirm rule), §7 ("the AI call fails" — the
same audit-trail rule extends to a failed confirm), §2 (`Message` fields).

**Why this file exists:** `2026-09-16-manual-bugs-found.md` bug 1 and
`2026-09-16-chat-flow-bugs-and-fixes.md` bug 9 both slipped through
`qa/tests/api/06-chat-confirm.test.ts` because every case there sends a
**complete, valid** payload (`api-chat-confirm.md`'s own CC-08 note: "the
one shape that crashes was the one shape untested"). This file is the
**incomplete-input** counterpart: a missing category, a category that
doesn't exist, an ambiguous name, and the create-category name→id path that
bug 9 broke. It also closes half of "Finding A" (`2026-09-16-manual-bugs-found.md`)
for the `messages` collection specifically — CC-* tests only ever checked a
message's `text`/`author`, never asserted the exact record a confirm (success
or failure) is supposed to leave behind.

**Level:** API — real HTTP against the spawned server, real test DB. No AI
call anywhere in this file (same reasoning as `api-chat-confirm.md`:
`/chat/confirm` never calls `backend/ai/`).

**Automation:** `qa/tests/api/09-chat-confirm-resolution.test.ts`.

---

### CR-01 — missing `category` on a create-expense draft → 400, nothing saved, and the failure is the one line of history
- **Method:** sign up a user. `POST /chat/confirm` `{ intent: "create-expense", drafts: [{ amount: 10 }] }` (no `category` key at all).
- **Expected:** `400 { error: "Which category should this go under?" }`. `GET /expenses` is empty. `GET /chat/messages` has exactly one message: `{ role: "assistant", author: <this user's id>, text: "Which category should this go under?" }` — every field checked, not just `text` (closes Finding A for `messages`).

### CR-02 — empty-string `category` → the same 400 as CR-01
- **Method:** `POST /chat/confirm` `{ intent: "create-expense", drafts: [{ amount: 10, category: "" }] }`.
- **Expected:** `400`, same message as CR-01 — an empty string must not slip past the falsy-check differently than an absent key (this is the exact shape of bug 1: `resolveCategory`'s guard is `if (!categoryNameOrId)`, and `""` is falsy too, but nothing before this run's pass ever exercised the string-vs-absent distinction at the HTTP layer). Nothing saved.

### CR-03 — a category name that does not exist → 400 "Create it first?", nothing saved
- **Method:** `POST /chat/confirm` `{ intent: "create-expense", drafts: [{ amount: 10, category: "Spaceship Fuel" }] }`.
- **Expected:** `400 { error: 'No category named "Spaceship Fuel". Create it first?' }`. `GET /expenses` empty. The exact message (not just its presence) is persisted as the next assistant message, full-shape checked as in CR-01.

### CR-04 — an ambiguous category name (2+ matches) → 400 with `candidates`, nothing saved
- **Method:** create two categories both literally named `"Misc"` — one as a main category, one as a subcategory of a different main (so `findByName(userId, "Misc")` with no `parentId` matches both, per `categoryService.findByName`'s own scoping rule). `POST /chat/confirm` `{ intent: "create-expense", drafts: [{ amount: 10, category: "Misc" }] }`.
- **Expected:** `400`, body's `error` starts with `"More than one category matches"`. Nothing saved.

### CR-05 — a batch with one bad category fails the whole batch, not a partial save
- **Method:** `POST /chat/confirm` `{ intent: "create-expense", drafts: [{ amount: 5, category: "Food" }, { amount: 6, category: "Nonexistent" }] }`.
- **Expected:** `400`. `GET /expenses` is still empty — the valid first draft must **not** have been saved on its own (this is `createManyExpenses`'s "resolve every category before any write" contract, the exact class of thing bug 9's contract mismatch broke silently). This is the one property from `2026-09-15-server-additions-testable.md`'s `createManyExpenses` row ("no partial save") tested through the real HTTP path instead of only at the service-unit level.

### CR-06 — a successful confirm's "Done." message is the full, correct record
- **Method:** `POST /chat/confirm` a valid `create-expense` draft. Then `GET /chat/messages`.
- **Expected:** exactly one new message: `{ role: "assistant", author: <this user's id>, text: "Done." }`, with a `createdAt` timestamp within the last few seconds. Every field checked — the class of assertion Finding A found missing everywhere except `users`.

### CR-07 — `create-category` resolves a name-based `parent` to a real id, not the string (bug 9 regression)
- **Method:** sign up a user (seeds default categories, including "Transport"). `GET /categories`, find "Transport"'s real `_id`. `POST /chat/confirm` `{ intent: "create-category", draft: { name: "Bike", parent: "Transport" } }`.
- **Expected:** `200`; `changed.parent` **equals Transport's real `_id` string**, never the literal string `"Transport"` — this is the exact contract mismatch bug 9 was (`categoryService.createCategory` resolving a name to an id before storing `parent`). `CC-08` in the sibling file only ever creates a **main** category with no parent, so this shape was never exercised there.

### CR-08 — `create-category` with a `parent` name that doesn't exist → 400, nothing saved
- **Method:** `POST /chat/confirm` `{ intent: "create-category", draft: { name: "Bike", parent: "Spaceships" } }`.
- **Expected:** `400 { error: "No such category to add a subcategory to." }`. `GET /categories` does not include "Bike".
