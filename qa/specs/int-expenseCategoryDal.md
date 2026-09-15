# Test spec — `dal/categoryRepository.js` + `dal/expenseRepository.js` additions (integration)

**Under test:** `backend/dal/categoryRepository.js` — `findOtherCategory`, `createManyCategories`, `deleteCategoriesByUser`. `backend/dal/expenseRepository.js` — `getExpenseTotalByCategory`, `findExpenseById`, `reassignExpensesToCategory`, `queryExpenses` (the `text` filter, and combined with a date range).
**Governing spec:** `docs/specs/08-expense-category-dal.md`.
**Level:** integration — real Mongo. `getExpenseTotalByCategory` is a Mongo aggregation pipeline; it cannot be exercised against a mock.
**Automation:** `qa/tests/integration/expenseCategoryDal.test.ts`.

---

### DL-01 — `findOtherCategory` finds the seeded "Other"; `null` if absent
- **Method:** seed `{ name: "Other", owner, parent: null }` for one user. Call `findOtherCategory(owner)`. Then call it for a second, unrelated user who has no categories.
- **Expected:** first call resolves the doc; second resolves `null`.

### DL-02 — `createManyCategories` bulk-inserts, `parent` refs round-trip correctly
- **Method:** `createManyCategories([{name:"A", owner, parent:null}, {name:"B", owner, parent:null}])`, then `createManyCategories([{name:"A-sub", owner, parent: <A._id>}])`.
- **Expected:** both calls resolve arrays of saved docs with real `_id`s; the second doc's `parent` equals the first `A`'s `_id`.

### DL-03 — `deleteCategoriesByUser` removes only that user's categories
- **Method:** seed 2 categories for user X, 1 for user Y. Call `deleteCategoriesByUser(X)`.
- **Expected:** `Category.countDocuments({owner:X})` is `0`; `Category.countDocuments({owner:Y})` is still `1`.

### DL-04 — `getExpenseTotalByCategory` totals are correct per category
- **Method:** seed 2 expenses on category `A` (10, 15) and 1 on category `B` (7), all for one user. Call `getExpenseTotalByCategory(userId)`.
- **Expected:** resolves rows equivalent to `{_id: A, total: 25}` and `{_id: B, total: 7}` (order-independent).

### DL-05 — `getExpenseTotalByCategory` narrows correctly by a date range
- **Method:** seed one expense dated 2026-01-01 (amount 10) and one dated 2026-02-01 (amount 20) on the same category, for one user. Call `getExpenseTotalByCategory(userId, new Date("2026-02-01"), new Date("2026-02-28"))`.
- **Expected:** resolves one row totalling `20` — the January expense is excluded.

### DL-06 — `getExpenseTotalByCategory` for a user with zero expenses resolves `[]`
- **Method:** call `getExpenseTotalByCategory(<a fresh, never-used userId>)`.
- **Expected:** resolves an empty array, not an error.

### DL-07 — `findExpenseById` — match / `null`
- **Method:** create one expense; call `findExpenseById(<its id>)`, then `findExpenseById(<a fresh ObjectId>)`.
- **Expected:** first resolves the doc; second resolves `null`.

### DL-08 — `reassignExpensesToCategory` moves every one of a user's expenses, and only that user's
- **Method:** seed 2 expenses for user X on category `A`, 1 expense for user Y on category `A`. Call `reassignExpensesToCategory(X, <category B id>)`.
- **Expected:** both of X's expenses now have `category === B`; Y's expense is untouched (`category === A`).

### DL-09 — `queryExpenses`'s `text` filter matches `store`/`description`, partial + case-insensitive
- **Method:** seed expenses with `store: "Aroma Coffee"`, `description: "team lunch"`, and a third with neither matching. Call `queryExpenses(userId, { text: "coffee" })` and separately `queryExpenses(userId, { text: "LUNCH" })`.
- **Expected:** the first call returns only the "Aroma Coffee" expense; the second returns only the "team lunch" one — case-insensitive, partial match, matching either field.

### DL-10 — `queryExpenses`'s `text` and date-range filters combine (both narrow, neither overrides)
- **Method:** seed: (a) store "Coffee Shop", dated 2026-01-05; (b) store "Coffee Shop", dated 2026-03-05; (c) store "Other Store", dated 2026-01-05. Call `queryExpenses(userId, { text: "coffee", from: new Date("2026-01-01"), to: new Date("2026-01-31") })`.
- **Expected:** resolves only expense (a) — matches both the text and the date range; (b) is excluded by date, (c) by text.
