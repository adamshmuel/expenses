# 08 — Expense and category data access

Status: **draft — needs Adam's approval.**

What functions `backend/dal/` needs for expenses and categories, and how they
are used by the layers above. Adam writes the code; this spec is the contract,
not the implementation. Schemas are [04-data-model.md](04-data-model.md);
this spec does not repeat them.

## Scope: v1 is create, edit, and delete — not open-ended questions

The chat (`/home`) parses text into one of seven intents — **create**,
**edit**, or **delete**, for either an **expense** or a **category**, plus
**reset** (categories only) — and always confirms before acting. The chat is
the only place either is written; `/dashboard` only reads. See
[01-ai-chat.md](01-ai-chat.md) §6 for the full flow.

It does not yet answer open-ended questions about past spending ("how much did
I spend on food this month" with no edit/delete intent). That is a separate
feature — it needs its own reply shape (an answer, not a draft or a match list)
— and gets its own spec, later.

This matters for the DAL: v1 does not need per-field finders
(`getExpensesByStore`, `getExpensesByCategory`, ...). It needs one flexible
`queryExpenses` function, covering the dashboard's period filter and the chat's
free-text match for edit/delete, so a future open-question feature extends it
rather than replacing it.

## Layers

Same shape as auth ([05-user-layers.md](05-user-layers.md)):

```
route → service (bl/) → repository (dal/) → model
```

| Layer | Knows about | Does not know about |
|---|---|---|
| `dal/expenseRepository.js`, `dal/categoryRepository.js` | Mongoose models only | `req`/`res`, HTTP status, business rules |
| `bl/expenseService.js`, `bl/categoryService.js` | DAL functions, business rules | `req`/`res` |
| `routes/expenses.js`, `routes/categories.js`, `routes/chat.js` | Service functions, HTTP | Mongoose |

A repository function returns the Mongoose query/promise directly, same as
`dal/userRepository.js`. A finder resolves to `null` when nothing matches.

## `backend/ai/` and the DAL

`backend/ai/` never touches the database (unchanged from
[01-ai-chat.md](01-ai-chat.md) §8). It receives data the route already fetched,
and returns an intent plus structured content — never a database call of its
own.

**Create** — matching free text like "coffee" against the user's real
categories, instead of inventing one. Also how the chat resolves a category
**name** for a new expense, or for `changes.category` on an edited expense
(moving it to a different category):

```
route:  categories = categoryService.getForUser(userId)
route:  result = ai.parseMessage(text, categories)
        // returns { intent: 'create-expense', drafts: [...] }
        // or      { intent: 'create-category', draft: {...} }
```

**Edit / delete** — matching free text like "the coffee from yesterday" or
"Fuel" against the user's own recent expenses or categories, so the chat can
offer real candidates to pick from:

```
route:  categories = categoryService.getForUser(userId)
route:  recent = expenseService.queryExpenses(userId, { from: <30 days ago> })
route:  result = ai.parseMessage(text, categories, recent)
        // returns one of:
        // { intent: 'create-expense',  drafts: [...] }
        // { intent: 'edit-expense',    searchFilters: {...}, changes: {...} }
        // { intent: 'delete-expense',  searchFilters: {...} }
        // { intent: 'create-category', draft: {...} }
        // { intent: 'edit-category',   searchFilters: {...}, changes: {...} }
        // { intent: 'delete-category', searchFilters: {...} }
```

`searchFilters` is passed straight to `queryExpenses` (for an expense) or
`getCategoriesByUser` plus a name match (for a category) — the AI extracts
search terms, the DAL runs the actual query. The route shows the matches and
asks the user to pick one (or reports "no match" / auto-picks when there is
exactly one), then shows the proposed change and asks for confirmation before
calling `updateExpense`/`deleteExpense` or `updateCategory`/`deleteCategory`.
Same confirm-before-acting rule as create, just with a pick step first when the
match isn't unique.

## Category functions

| Function | Covers |
|---|---|
| `getCategoriesByUser(userId)` | Chat: category list passed to the AI for every intent (name resolution, matching). Dashboard: breakdown labels, category list |
| `findCategoryById(id)` | Validating a draft's category before saving |
| `findOtherCategory(userId)` | The reassignment middleware ([04-data-model.md](04-data-model.md)): where a deleted category's expenses move to |
| `createCategory(obj)` | Chat: save a confirmed new category |
| `updateCategory(id, obj)` | Chat: apply a confirmed rename. Returns the updated document (`{ new: true }`) |
| `deleteCategory(id)` | Chat: apply a confirmed delete (the model middleware moves its expenses to "Other") |
| `createManyCategories(docs)` | Sign-up: copy the default set. Chat `reset-categories` intent: copy defaults again |
| `deleteCategoriesByUser(userId)` | Chat `reset-categories` intent: clear before copying |

## Expense functions

| Function | Covers |
|---|---|
| `createExpense(obj)` | Chat: save one confirmed new expense |
| `createManyExpenses(docs)` | Chat: save several confirmed new expenses from one message, in one insert |
| `queryExpenses(userId, filters)` | Dashboard: period filter (`from`, `to`). Chat edit/delete: matching text + date against the user's expenses (`text`, `from`, `to`) |
| `findExpenseById(id)` | The ownership check `expenseService.editExpense`/`deleteExpense` run before acting on the id the user already picked ([09-expense-category-service.md](09-expense-category-service.md)) |
| `updateExpense(id, obj)` | Chat: apply a confirmed edit. Returns the updated document (`{ new: true }`) |
| `deleteExpense(id)` | Chat: apply a confirmed delete |
| `reassignExpensesToCategory(userId, categoryId)` | `Expense.updateMany({ user: userId }, { category: categoryId })`. Used by `categoryService.resetToDefaults` ([09-expense-category-service.md](09-expense-category-service.md)) to point every one of this user's expenses at "Other" before their categories are wiped |
| `getExpenseTotalByCategory(userId, from, to)` | Dashboard breakdown. A Mongo aggregation (`$group`/`$sum`), not a JS loop over fetched docs — matches [02-dashboard.md](02-dashboard.md) open question 2: totals are calculated by the database |

`filters` on `queryExpenses` is a plain object. The function builds a Mongoose
query from whichever keys are present:

| Key | Applies to |
|---|---|
| `from`, `to` | `date`, as a `$gte`/`$lte` range |
| `text` | `store` **or** `description`, case-insensitive partial match (`$or` of two regexes) |

This is what makes it a "query builder" without being a separate abstraction —
it is one function, and the filter object is a plain object, not a class. A
future open-ended-question feature adds more keys the same way; it does not
need a new function.

## What this earns

| Course topic | Demo | Where |
|---|---|---|
| DAL / BL layers | 8 | `expenseRepository`/`categoryRepository` mirror `userRepository` |
| CRUD | 13 | Create, read (filtered), update, and delete — both categories and expenses |
| Population | 23 | `queryExpenses` results populate `category` |
| Aggregation | — | `getExpenseTotalByCategory` |

## Open questions

None — open-ended spending questions (with no edit/delete intent) are
deliberately deferred, not open; that gets its own spec when work on it
starts.
