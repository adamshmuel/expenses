# Test spec — `bl/expenseService.js` (integration: `createManyExpenses`)

**Under test:** `backend/bl/expenseService.js` — `createManyExpenses`.
**Governing spec:** `docs/specs/09-expense-category-service.md` §3.
**Level:** integration — real Mongo. `insertMany`'s all-or-nothing behaviour (and the "resolve every category before any write" ordering) can't be proven against a mock; needs a real collection to show nothing was partially written.
**Automation:** `qa/tests/integration/expenseService.test.ts`.

---

### EI-01 — a batch where every draft's category resolves saves all of them
- **Method:** seed one category "Food" for a user. Call `expenseService.createManyExpenses(userId, [{amount:10,category:"Food"}, {amount:20,category:"Food"}])`.
- **Expected:** resolves 2 saved documents. `Expense.countDocuments({ user: userId })` is `2`.

### EI-02 — one bad category name in a batch of N fails the whole batch — no partial save
- **Method:** seed one category "Food" for a user. Call `expenseService.createManyExpenses(userId, [{amount:10,category:"Food"}, {amount:20,category:"Ghost"}])` (the second name matches nothing).
- **Expected:** rejects with `{ status: 400, message: 'No category named "Ghost". Create it first?' }`. `Expense.countDocuments({ user: userId })` is `0` — the first (valid) draft was never written, because every draft's category is resolved **before** the single `insertMany` call.
