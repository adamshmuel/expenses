# 08 — Expense and category data access

Status: **draft — needs Adam's approval.**

What functions `backend/dal/` needs for expenses and categories, and how they
are used by the layers above. Adam writes the code; this spec is the contract,
not the implementation. Schemas are [04-data-model.md](04-data-model.md);
this spec does not repeat them.

## Scope: v1 is record-only

The chat (`/home`) parses and saves expenses. It does not yet answer questions
about past spending ("how much did I spend at IKEA"). That is a real feature,
but a separate one — it needs intent detection (is this text a new expense or
a question?) and a different reply shape. It gets its own spec, later.

This matters for the DAL: v1 does not need per-field finders
(`getExpensesByStore`, `getExpensesByCategory`, ...). It needs one flexible
`queryExpenses` function, built now so the dashboard's period filter and v2's
chat-query feature both use it without a rewrite.

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
[01-ai-chat.md](01-ai-chat.md) §8). To match free text like "coffee" against
the user's real categories instead of inventing one, the **route** fetches the
category list first and passes it in as plain data:

```
route:  categories = categoryService.getForUser(userId)
route:  result = ai.parseExpense(text, categories)
        // ai module receives categories as data, returns drafts that
        // reference an existing category id, or mark one as new
```

## Category functions

| Function | Covers |
|---|---|
| `getCategoriesByUser(userId)` | Chat: category list passed to the AI. Category screen: list view. Dashboard: breakdown labels |
| `findCategoryById(id)` | Validating a draft's category before saving. Category screen: edit/delete lookups |
| `findOtherCategory(userId)` | The reassignment middleware ([04-data-model.md](04-data-model.md)): where a deleted category's expenses move to |
| `createCategory(obj)` | Category screen: add a main or subcategory |
| `updateCategory(id, obj)` | Category screen: rename |
| `deleteCategory(id)` | Category screen: delete (the model middleware moves its expenses to "Other") |
| `createManyCategories(docs)` | Sign-up: copy the default set. Reset: copy defaults again |
| `deleteCategoriesByUser(userId)` | Reset to defaults: clear before copying |

## Expense functions

| Function | Covers |
|---|---|
| `createExpense(obj)` | Chat: save one confirmed draft |
| `createManyExpenses(docs)` | Chat: save several confirmed drafts from one message, in one insert |
| `queryExpenses(userId, filters)` | Dashboard: period filter (`from`, `to`). v2: chat questions add `store`, `category`, `amount` filters — same function, more filter fields |
| `getExpenseTotalByCategory(userId, from, to)` | Dashboard breakdown. A Mongo aggregation (`$group`/`$sum`), not a JS loop over fetched docs — matches [02-dashboard.md](02-dashboard.md) open question 2: totals are calculated by the database |

`filters` on `queryExpenses` is a plain object (e.g. `{ from, to }` in v1). The
function builds a Mongoose query from whichever keys are present. This is what
makes it a "query builder" without being a separate abstraction — it is one
function, and the filter object is a plain object, not a class.

## What this earns

| Course topic | Demo | Where |
|---|---|---|
| DAL / BL layers | 8 | `expenseRepository`/`categoryRepository` mirror `userRepository` |
| CRUD | 13 | Create categories/expenses; read with filters; update/delete categories |
| Population | 23 | `queryExpenses` results populate `category` |
| Aggregation | — | `getExpenseTotalByCategory` |

## Open questions

None — v2 (chat spending questions) is deliberately deferred, not open; it
gets its own spec when work on it starts.
