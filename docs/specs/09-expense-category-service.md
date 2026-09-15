# 09 — The expense and category layers: repository, service, route

Status: **approved.**

How the chat's seven intents ([01-ai-chat.md](01-ai-chat.md) §6) and the
read-only dashboard endpoints are built, split into the same three layers as
auth ([05-user-layers.md](05-user-layers.md)):

```
routes/chat.js, routes/expenses.js, routes/categories.js
     ↓ (HTTP, confirm-flow orchestration)
bl/expenseService.js, bl/categoryService.js
     ↓ (business rules)
dal/expenseRepository.js, dal/categoryRepository.js
     ↓ (database only)
models
```

Each layer only ever calls the one below it. The route never imports a
repository; the repository never reads `req` or sends a response. Adam writes
all of it himself. This spec says **what each function does and what it
returns**, not how to write the code.

The repository layer is already specified and built —
[08-expense-category-dal.md](08-expense-category-dal.md). This spec covers the
service and route layers on top of it.

## 1. Why the route, not the service, orchestrates the chat flow

`bl/expenseService.js` and `bl/categoryService.js` expose small, single-purpose
functions — one rule-checked action each, same shape as `userService`
(`login`, `signup`, `refresh`, each one call). Neither service knows what an
"intent" is, or that a confirmation happens across two HTTP requests.

`routes/chat.js` is what strings the calls together: call `backend/ai/`, run
the returned `searchFilters` through a service search function, show the
matches, wait for the second request, then call the matching create/edit/
delete/reset function. This mirrors [05](05-user-layers.md) §1's division:
services hold rules, routes hold the flow.

## 2. `bl/categoryService.js`

Imports `categoryRepository`. Never imports a model directly. Enforces the
category rules from [04-data-model.md](04-data-model.md) explicitly, before
calling the repository — the same division as `userService`'s "username
already taken" check ([05](05-user-layers.md) §7): a clear, specific error
here, the database's own constraints (the unique index, `isProtected`) as the
last-resort safety net behind it.

### `getForUser(userId)`

`getCategoriesByUser(userId)`. No rules to check — a plain read. Used by the
chat route (to pass categories into every `backend/ai/` call) and by
`GET /categories` for the dashboard.

### `findByName(userId, name, parentId)`

Matches free text like "Fuel" or "Entertainment" against the user's own
categories — this is how `expenseService` resolves a category name to a
document, and how the chat's `searchFilters` for `edit-category`/
`delete-category` finds candidates. `getCategoriesByUser(userId)`, filtered in
memory by name (case-insensitive) and, if given, by parent. Returns the list
of matches — zero, one, or several; the route decides what to show based on
the count, same as an expense search.

### `createCategory(userId, { name, parent })`

1. If `parent` is given, `findCategoryById(parent)` and confirm it belongs to
   this user and has no `parent` of its own — **two levels only**
   ([04](04-data-model.md)).
   - Not found, or belongs to another user → throw `{ status: 400, message:
     "No such category to add a subcategory to." }`.
   - Found, but it already has a `parent` of its own → throw `{ status: 400,
     message: "Categories can only be two levels deep." }`.
2. `findByName(userId, name, parent)` — if a category with this name already
   exists under the same parent for this user → throw `{ status: 409, message:
   "A category named \"<name>\" already exists here." }` (matches the compound
   unique index in [04](04-data-model.md)).
3. `createCategory({ name, parent: parent ?? null, owner: userId })`.
4. Return the saved document.

### `updateCategory(userId, id, { name })`

1. `findCategoryById(id)`.
   - Not found, or `owner` is not this user → throw `{ status: 404, message:
     "Category not found." }`.
2. `isProtected` → throw `{ status: 400, message: "\"Other\" cannot be
   renamed." }`.
3. If renaming: `findByName(userId, name, category.parent)` — same question as
   create step 2 ("does this name already exist under this parent?"), but the
   category **being renamed** can match its own current name in that search
   result, and that is not a real duplicate. So: filter the result to remove
   any match whose `_id` equals `id` first, **then** check if anything is left
   → throw `{ status: 409, message: "A category named \"<name>\" already
   exists here." }` (same message as create, different check — create has
   nothing yet to accidentally match itself, so it never needs this filter
   step).
4. `updateCategory(id, { name })`. Return the updated document.

### `deleteCategory(userId, id)`

1. `findCategoryById(id)`.
   - Not found, or wrong owner → throw `{ status: 404, message: "Category not
     found." }`.
2. `isProtected` → throw `{ status: 400, message: "\"Other\" cannot be
   deleted." }`.
3. `deleteCategory(id)`. The expense-reassignment-to-"Other" behaviour is a
   **model middleware** ([04](04-data-model.md)) — this function does not
   reimplement it, it only triggers it by deleting.
4. Return nothing meaningful (the route replies with the chat confirmation
   text, not the deleted document).

### `seedDefaultCategories(userId)`

Creates one user's starting set of categories from scratch. Used by **two**
callers: `userService.signup` (a brand-new user's first categories) and
`resetToDefaults` below (after their old categories are cleared out). One
function, one place the mains-then-subcategories logic lives, so the two
callers can never drift apart — this is the "kept in one place" requirement
from [04-data-model.md](04-data-model.md).

The default category list itself does not exist in the code yet. It is a
plain constant, not a database read — add `backend/constants/defaultCategories.js`
with exactly this content, taken from [04](04-data-model.md)'s table:

```js
module.exports = [
  { name: "Food", subcategories: ["Groceries", "Restaurants", "Coffee"] },
  { name: "Transport", subcategories: ["Fuel", "Public transport", "Parking"] },
  { name: "Home", subcategories: ["Rent", "Utilities", "Internet"] },
  { name: "Health", subcategories: [] },
  { name: "Clothing", subcategories: [] },
  { name: "Entertainment", subcategories: [] },
  { name: "Education", subcategories: [] },
  { name: "Other", subcategories: [], isProtected: true },
];
```

Every entry is a main category; `subcategories` is a plain array of names, not
yet `Category` documents — turning a name into `{ name, parent, owner }` is
`seedDefaultCategories`'s own job, because `owner` and the real `parent` id
are only known at the point a specific user is being set up. This file has no
`owner` in it and is never saved to the database itself; `categoryService`
imports it, `userService` does not.

`seedDefaultCategories(userId)` turns it into real documents, in two passes —
a subcategory needs its main category's real database `_id`, which does not
exist until the mains are saved, so this cannot be one `insertMany` call:

1. **Pass one:** for each entry in `defaultCategories.js`, build `{ name:
   entry.name, parent: null, owner: userId, isProtected: !!entry.isProtected
   }`. Call `createManyCategories(mains)` with that array. The result is the
   saved main-category documents, each with a real `_id`.
2. **Pass two:** for each entry that has `subcategories`, find the saved main
   document from pass one with the matching `name`, and build `{ name:
   subName, parent: <that main's _id>, owner: userId }` for every name in
   `entry.subcategories`. Call `createManyCategories(subcategories)` with that
   array.
3. Return the newly created categories (mains and subcategories together —
   e.g. the two arrays concatenated).

### `resetToDefaults(userId)`

For the chat's `reset-categories` intent. No search, no match — applies to all
of this user's categories at once.

1. `findOtherCategory(userId)`, then reassign every one of this user's
   expenses to it — a repository call on `expenseRepository` (e.g.
   `Expense.updateMany({ user: userId }, { category: otherCategory._id })`;
   not yet in [08](08-expense-category-dal.md)'s table, add it there when this
   is built). This must happen **before** the delete in step 2 — by the time
   "Other" itself is deleted, nothing should still point at any category
   being removed.
2. `deleteCategoriesByUser(userId)`. This requires one change to
   [backend/models/categoryModel.js](../../backend/models/categoryModel.js)'s
   `pre("deleteMany")` hook: it currently rejects the whole batch if anything
   matched is `isProtected`, which would always reject a real reset (every
   user's own "Other" is always in that batch). The hook needs to allow a
   protected category through specifically when the `deleteMany` filter is
   scoped to a single `owner` (i.e. a real "wipe this user's categories"
   call) — step 1 already emptied every category of its expenses first, so
   there is nothing left to reassign inside the hook itself; it only needs to
   stop blocking the delete.
3. `seedDefaultCategories(userId)`. Return what it returns.

## 3. `bl/expenseService.js`

Imports `expenseRepository` and `categoryService`. Never imports a model
directly.

### `getForUser(userId, filters)`

`queryExpenses(userId, filters)`. A plain, rule-free read — used by the chat's
edit/delete search step, by the "recent expenses" context passed into every
`backend/ai/` call ([08](08-expense-category-dal.md)), and by
`GET /expenses`/`GET /expenses/summary` for the dashboard.

### `resolveCategory(userId, categoryNameOrId)`

Private helper, not exported. A new or edited expense's category arrives from
`backend/ai/` as a **name** ([08](08-expense-category-dal.md)) — this is the
one place that turns it into a real category document.

1. `categoryService.findByName(userId, categoryNameOrId)`.
2. Zero matches → throw `{ status: 400, message: "No category named
   \"<name>\". Create it first?" }` — **the model never invents a category**,
   this mirrors the "never invents an amount" rule in [01](01-ai-chat.md) §6.
3. More than one match (e.g. same subcategory name under two different mains)
   → throw `{ status: 400, message: "More than one category matches
   \"<name>\".", candidates: [...] }` so the route can ask the user which one.
4. Exactly one match → return it.

### `createExpense(userId, { amount, store, description, date, category })`

1. `resolveCategory(userId, category)`.
2. `createExpense({ amount, store, description, date, category: categoryDoc._id, user: userId })`.
3. Return the saved document.

Amount and date rules (amount required and > 0, date defaults to today) are
schema-level ([04](04-data-model.md)) — Mongoose is the safety net here, same
as `User`'s field rules in [05](05-user-layers.md).

### `createManyExpenses(userId, drafts)`

Resolves every draft's category first (`resolveCategory` per draft, so one bad
category name fails before anything is written — no partial save), then
`createManyExpenses(docs)` with `user: userId` stamped on each. Return the
saved documents.

### `editExpense(userId, id, changes)`

1. `findExpenseById(id)` — **not** `queryExpenses` again; the id is already
   chosen, the user picked it from the chat's match list
   ([01](01-ai-chat.md) §6).
   - Not found, or `user` is not `userId` → throw `{ status: 404, message:
     "Expense not found." }`.
2. If `changes.category` is present, `resolveCategory(userId,
   changes.category)` and replace it with the resolved `_id`.
3. `updateExpense(id, changes)`. Return the updated document.

### `deleteExpense(userId, id)`

Same ownership check as `editExpense` step 1 (same `{ status: 404, message:
"Expense not found." }`), then `deleteExpense(id)`.

## 4. `routes/chat.js`

Ties the two-request flow from [01-ai-chat.md](01-ai-chat.md) §6 together.
Every handler wrapped in `catchAsync`, protected by `requireAuth`.

### `POST /chat/messages` — request one, every intent

1. Save the user's message (`Message`, role `user`).
2. `categories = categoryService.getForUser(req.user.id)`.
3. `recent = expenseService.getForUser(req.user.id, { from: <30 days ago> })`.
4. `result = ai.parseMessage(text, categories, recent)` — one of the seven
   intents ([08](08-expense-category-dal.md)).
5. By intent:
   - `create-expense` / `create-category` — the drafts are the response, no DB
     write yet.
   - `edit-expense` / `delete-expense` — `expenseService.getForUser(userId,
     result.searchFilters)`.
   - `edit-category` / `delete-category` — `categoryService.findByName(userId,
     result.searchFilters.text)`.
   - `reset-categories` — nothing to search; the response is a confirmation
     prompt only.
6. Save the reply (`Message`, role `assistant`).
7. Respond with the reply text, the intent, and whatever was found (drafts, or
   matches to pick from).

### `POST /chat/confirm` — request two, every intent

1. Body carries the intent and either the confirmed drafts, or the chosen
   id(s) plus the change.
2. Call the one matching service function:

   | Intent | Service call |
   |---|---|
   | `create-expense` | `expenseService.createExpense` or `createManyExpenses` |
   | `edit-expense` | `expenseService.editExpense` |
   | `delete-expense` | `expenseService.deleteExpense` |
   | `create-category` | `categoryService.createCategory` |
   | `edit-category` | `categoryService.updateCategory` |
   | `delete-category` | `categoryService.deleteCategory` |
   | `reset-categories` | `categoryService.resetToDefaults` |

3. Respond with what changed. Nothing here calls `backend/ai/` again — the
   text was already parsed in request one.

On cancel, the client simply never calls `/chat/confirm` — nothing to undo.

## 5. `routes/expenses.js`, `routes/categories.js` — read-only

For `/dashboard`. No create/edit/delete here — see
[00-overview.md](00-overview.md) and [02-dashboard.md](02-dashboard.md): the
chat is the only place either is written.

| Method + path | Calls | Purpose |
|---|---|---|
| `GET /expenses?from=&to=` | `expenseService.getForUser` | recent-expenses list |
| `GET /expenses/summary?from=&to=` | `expenseRepository.getExpenseTotalByCategory` directly (a plain aggregation read, no rule to enforce — the one place a route may skip the service, same as any pure read) | category breakdown |
| `GET /categories` | `categoryService.getForUser` | category list, labels |

## 6. Errors, end to end

Same shape as [05](05-user-layers.md) §8 and the central handler
([06-server-modules.md](06-server-modules.md) §3): a thrown error with
`.status` becomes that status and `.message` becomes the response's `error`
text; anything else is a 500. The exact message for each case is written next
to the step that throws it, in §2 and §3 above — this is only an index of
where to look.

| Situation | Thrown by |
|---|---|
| No such parent, or parent already has a parent | `categoryService.createCategory` §2 step 1 |
| Duplicate category name under the same parent | `categoryService.createCategory`/`updateCategory` §2 steps 2/3 (409 only if it slips past to Mongo's unique index instead) |
| Category not found, or belongs to another user | `categoryService.updateCategory`/`deleteCategory` §2 step 1 |
| Renaming or deleting "Other" | `categoryService.updateCategory`/`deleteCategory` §2 step 2 |
| Expense not found, or belongs to another user | `expenseService.editExpense`/`deleteExpense` §3 step 1 |
| A draft or edit names a category that does not exist | `expenseService.resolveCategory` §3 step 2 |
| A draft or edit's category name matches more than one category | `expenseService.resolveCategory` §3 step 3 |
| Amount missing or not > 0, on a create | Mongoose validation ([04](04-data-model.md)), not a service throw |
| The AI call fails or times out | `backend/ai/`, 502 ([01](01-ai-chat.md) §8) |

## 7. Course-topic coverage

| Topic | Demo | Where |
|---|---|---|
| DAL / BL layers | 8 | `route → service → repository`, mirrors [05](05-user-layers.md) |
| Routes, route per resource | 10, 15 | `routes/chat.js`, `routes/expenses.js`, `routes/categories.js` |
| Route params | 11 | `GET /expenses/:id`-style lookups inside `editExpense`/`deleteExpense` |
| Query string | 12 | `GET /expenses?from=&to=`, `GET /expenses/summary?from=&to=` |
| CRUD | 13 | Create/edit/delete expenses and categories, all via the service layer |
| Middleware | 14 | `requireAuth` on `/chat`, `/expenses`, `/categories` |
| Error handling | 16 | `catchAsync`, the shared central handler |
| Mongoose | 18 | `Expense`, `Category`, via the repository |
| Population | 23 | `getForUser` results populate `category` |
| Advanced security | 24 | every route here behind `requireAuth`; scoped by `userId` first |

## 8. Open questions

None. `findByName`/`resolveCategory`'s "more than one match" case (two
*different* main categories can each have a same-named subcategory, e.g. two
"Coffee" subcategories under different mains) is confirmed in scope, not a
hypothetical — §3 already handles it. `resetToDefaults`'s two dependencies
(a new repository function, and a change to `Category`'s `pre("deleteMany")`
hook) are decided in §2, not open — flagged there because they touch files
outside this spec's own layer.
