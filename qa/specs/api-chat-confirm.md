# Test spec — `POST /chat/confirm` (API)

**Under test:** `backend/routes/chatRoute.js` — `POST /chat/confirm`.
**Governing spec:** `docs/specs/09-expense-category-service.md` §4 "request two"; `docs/specs/01-ai-chat.md` §6.
**Level:** API — real HTTP against the spawned server, real test DB. `/chat/confirm` never calls `backend/ai/` (per spec §4 step 3 and the server-additions-testable file's own note) — every branch here is testable without touching Gemini, unlike `POST /chat/messages` (see `qa/specs/api-chat-messages.md` and blocker B7 in `qa/test-roadmap.md`).
**Automation:** `qa/tests/api/06-chat-confirm.test.ts`.

**Fixed since the 2026-09-15 pass:** `backend/models/categoryModel.js`'s four middleware hooks used to throw `TypeError: next is not a function` on every invocation (an async Mongoose hook was written to call a `next` callback that Mongoose never supplies). Fixed by dropping the `next` parameter and using `throw`/`return` instead — see `qa/specs/int-categoryModel.md` (CH-01..CH-16, now passing). `categoryService.createCategory`/`updateCategory`/`deleteCategory`/`resetToDefaults` all go through one of those hooks, so CC-08..CC-11 below now assert the spec's actual success behaviour, not the old 500.

---

### CC-01 — no `Authorization` header → 401
- **Method:** `POST /chat/confirm` with `{ intent: "create-expense", drafts: [{ amount: 1, category: "Food" }] }`, no auth header.
- **Expected:** `401`. The service layer is never reached (no expense is created).

### CC-02 — `create-expense` with a single draft saves one expense, every field correct
- **Method:** sign up a user (seeds default categories, incl. "Food"). `POST /chat/confirm` `{ intent: "create-expense", drafts: [{ amount: 12.5, store: "Aroma", category: "Food" }] }` with `Authorization: Bearer <accessToken>`.
- **Expected:** `200 { changed: <the saved expense> }`; `changed.amount === 12.5`, `changed.store === "Aroma"`, `changed.category` equals "Food"'s real `_id` (fetched via `GET /categories`) — **not** the string `"Food"` — and `changed.date` falls on today's date (UTC calendar day). **Strengthened 2026-09-16** — the original version of this test asserted only `amount` and that a row with the returned `_id` existed (see `2026-09-16-manual-bugs-found.md`, Finding A's "concrete example": this exact test "never checks that `store` came back... or that `category` resolved to Food"). A follow-up `GET /expenses` for this user includes the same row, unchanged.

### CC-03 — `create-expense` with `drafts.length > 1` uses the batch path, every field correct on both
- **Method:** same user. `POST /chat/confirm` with two drafts of different amounts, both category `"Food"`.
- **Expected:** `200 { changed: [<2 saved expenses>] }`, each with the right `amount` (matched by value, not just count) and `category` equal to "Food"'s real `_id`. `GET /expenses` shows both. **Strengthened 2026-09-16** alongside CC-02, same reasoning.

### CC-04 — `edit-expense` updates the named field
- **Method:** create an expense via CC-02's flow. `POST /chat/confirm` `{ intent: "edit-expense", id: <its id>, changes: { amount: 99 } }`.
- **Expected:** `200 { changed: {...amount:99...} }`.

### CC-05 — `edit-expense` with `changes.category` (a name) moves the expense
- **Method:** same expense as CC-04, now on "Food". `POST /chat/confirm` `{ intent: "edit-expense", id, changes: { category: "Transport" } }` (an existing default category).
- **Expected:** `200`; the returned `changed.category` is `"Transport"`'s real id, not the string `"Transport"`.

### CC-06 — `delete-expense` removes it
- **Method:** create an expense; `POST /chat/confirm` `{ intent: "delete-expense", id }`.
- **Expected:** `200`; a follow-up `GET /expenses` no longer includes that id.

### CC-07 — `edit-expense`/`delete-expense` on someone else's expense id → 404
- **Method:** user A creates an expense. User B (separate signup) calls `POST /chat/confirm` `{ intent: "delete-expense", id: <A's expense id> }`.
- **Expected:** `404 { error: "Expense not found." }`. A's expense is untouched.

### CC-08 — `create-category` saves a new main category
- **Method:** sign up a user. `POST /chat/confirm` `{ intent: "create-category", draft: { name: "Pets" } }`.
- **Expected:** `200 { changed: <saved category> }`; `changed.name === "Pets"` with a real `_id`. A follow-up `GET /categories` includes it.

### CC-09 — `edit-category` renames it
- **Method:** `POST /chat/confirm` `{ intent: "edit-category", id: <"Food"'s id>, changes: { name: "Renamed" } }`.
- **Expected:** `200 { changed: {...name:"Renamed"...} }`.

### CC-10 — `delete-category` removes it and reassigns its expenses to "Other"
- **Method:** create an expense under "Food". `POST /chat/confirm` `{ intent: "delete-category", id: <"Food"'s id> }`.
- **Expected:** `200`; "Food" no longer appears in `GET /categories`; the earlier expense's `category` is now "Other"'s id (the model's `pre("findOneAndDelete")` hook does the reassignment).

### CC-11 — `reset-categories` wipes and reseeds, and existing expenses land on the new "Other"
- **Method:** create an expense under "Food". `POST /chat/confirm` `{ intent: "reset-categories" }`.
- **Expected:** `200 { changed: [<fresh default categories>] }`, non-empty, includes a new "Other". The earlier expense's `category` is now the **new** "Other"'s id (not the deleted one's) — proves `categoryService.resetToDefaults`'s reorder fix: delete old categories → reseed → reassign to the new "Other".

### CC-12 — an unrecognized `intent` falls through the switch with `changed` left `undefined`, still `200`
- **Method:** `POST /chat/confirm` `{ intent: "not-a-real-intent" }`.
- **Expected:** `200 { changed: null }` (JSON has no `undefined`; `JSON.stringify({changed:undefined})` drops the key, so the body is `{}` — assert the parsed body has no `changed` key, or it is `undefined`/absent). Documents the gap already flagged in `2026-09-15-server-additions-testable.md` — no request-body validation on `intent`. Not a QA-owned fix (Adam's route file).
