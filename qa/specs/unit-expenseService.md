# Test spec — `bl/expenseService.js` (unit)

**Under test:** `backend/bl/expenseService.js` — `getForUser`, `createExpense`, `editExpense`, `deleteExpense`, and the private `resolveCategory` exercised through them.
**Governing spec:** `docs/specs/09-expense-category-service.md` §3.
**Level:** unit. `expenseRepository` and `categoryService` are replaced with test doubles. No database. `createManyExpenses`'s "no partial save" property needs a real DB (`insertMany` semantics) — covered in `qa/specs/int-expenseService.md`.
**Automation:** `qa/tests/unit/expenseService.test.ts`.

---

### ES-01 — `resolveCategory` (via `createExpense`): zero matches → 400
- **Purpose:** the model never invents a category (spec §3 `resolveCategory` step 2).
- **Method:** `categoryService.findByName` resolves `[]`. Call `createExpense("u1", { amount: 10, category: "Ghost" })`.
- **Expected:** rejects `{ status: 400, message: 'No category named "Ghost". Create it first?' }`. `expenseRepository.createExpense` never called.

### ES-02 — `resolveCategory`: more than one match → 400 with `candidates`
- **Purpose:** two different mains can each have a same-named subcategory (spec §3 step 3, confirmed in scope by 09 §8).
- **Method:** `categoryService.findByName` resolves two docs named "Coffee". Call `createExpense("u1", { amount: 10, category: "Coffee" })`.
- **Expected:** rejects `{ status: 400, message: 'More than one category matches "Coffee".', candidates: [<the two docs>] }`.

### ES-03 — `createExpense` resolves the category name to an id before saving
- **Purpose:** spec §3 `createExpense` steps 1–2.
- **Method:** `categoryService.findByName` resolves one doc `{ _id: "cat1" }`. `expenseRepository.createExpense` resolves a saved doc. Call `createExpense("u1", { amount: 12, store: "Aroma", category: "Coffee" })`.
- **Expected:** `expenseRepository.createExpense` called once with `{ amount: 12, store: "Aroma", description: undefined, date: undefined, category: "cat1", user: "u1" }`.

### ES-04 — `editExpense` on a missing or foreign expense → 404
- **Purpose:** ownership check via `findExpenseById`, not a second query (spec §3 `editExpense` step 1).
- **Method:** case A — `expenseRepository.findExpenseById` resolves `null`. case B — resolves `{ _id: "e1", user: { toString: () => "someone-else" } }`. Call `editExpense("u1", "e1", { amount: 20 })`.
- **Expected:** both reject `{ status: 404, message: "Expense not found." }`. `expenseRepository.updateExpense` never called.

### ES-05 — `editExpense` resolves `changes.category` to an id when present
- **Purpose:** moving an expense to a different category is an ordinary edit whose `changes.category` arrives as a name (spec §3 step 2; `01-ai-chat.md` §6).
- **Method:** `findExpenseById` resolves `{ _id: "e1", user: { toString: () => "u1" } }`. `categoryService.findByName` resolves one doc `{ _id: "cat2" }`. `updateExpense` resolves. Call `editExpense("u1", "e1", { category: "Entertainment" })`.
- **Expected:** `expenseRepository.updateExpense` called with `("e1", { category: "cat2" })` — the name is replaced in place.

### ES-06 — `editExpense` with no `changes.category` passes `changes` through untouched
- **Purpose:** an edit that does not move the expense skips category resolution entirely (spec §3 step 2 "If `changes.category` is present").
- **Method:** `findExpenseById` resolves an owned expense. `updateExpense` resolves. Call `editExpense("u1", "e1", { amount: 30 })`.
- **Expected:** `categoryService.findByName` never called. `updateExpense` called with `("e1", { amount: 30 })`.

### ES-07 — `deleteExpense` on a missing or foreign expense → 404
- **Purpose:** same ownership check as `editExpense` (spec §3 `deleteExpense`).
- **Method:** `findExpenseById` resolves `null`, then resolves an expense owned by another user, across two calls.
- **Expected:** both reject `{ status: 404, message: "Expense not found." }`.

### ES-08 — `deleteExpense` happy path delegates to the repository
- **Purpose:** the owned/found case.
- **Method:** `findExpenseById` resolves `{ _id: "e1", user: { toString: () => "u1" } }`. `deleteExpense` resolves. Call `deleteExpense("u1", "e1")`.
- **Expected:** `expenseRepository.deleteExpense` called once with `"e1"`.

### ES-09 — `getForUser` is a rule-free passthrough of filters
- **Purpose:** used by the dashboard and the chat's edit/delete search step alike, with no logic of its own (spec §3 `getForUser`).
- **Method:** `queryExpenses` resolves `[]`. Call `getForUser("u1", { from: "2026-01-01", text: "coffee" })`.
- **Expected:** `expenseRepository.queryExpenses` called once with `("u1", { from: "2026-01-01", text: "coffee" })` — unchanged.
