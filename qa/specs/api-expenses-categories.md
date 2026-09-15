# Test spec — `GET /expenses`, `GET /expenses/summary`, `GET /categories` (API)

**Under test:** `backend/routes/expensesRoute.js`, `backend/routes/categoriesRoute.js`.
**Governing spec:** `docs/specs/09-expense-category-service.md` §5.
**Level:** API — real HTTP, real test DB. These are the three read-only endpoints the dashboard (`client/src/api/dashboardApi.ts`) calls directly. Fixture expenses are seeded via `POST /chat/confirm` `create-expense` (real, unaffected by the `categoryModel.js` bug — see `qa/specs/api-chat-confirm.md`) against a signed-up user's default categories, so no direct DB writes are needed here.
**Automation:** `qa/tests/api/08-expenses-categories.test.ts`.

**Finding, fixed since the 2026-09-15 pass:**
`expenseRepository.getExpenseTotalByCategory(userId, from, to)` used to build
its `$match` stage as `{ user: userId }` (a plain string) straight into
`Expense.aggregate([...])`, which never auto-casts to `ObjectId` the way
`.find()` does. Fixed by wrapping `new mongoose.Types.ObjectId(userId)`.
ER-08/ER-09 (no `from`/`to` in the request — see below) now pass.

**New finding, still open (severe, ship-blocking for the Dashboard — see the
run report):** with the id-matching fixed, a **second, separate** instance of
the same "raw `.aggregate()` doesn't auto-cast" bug class is now visible for
**dates**. Neither `queryExpenses` (`GET /expenses`) nor
`getExpenseTotalByCategory` (`GET /expenses/summary`) construct a real `Date`
from the `from`/`to` query-string params before comparing them against the
schema's `Date`-typed `date` field:

- `queryExpenses` uses `Model.find()`, which *does* auto-cast a string to
  `Date` for a `$gte`/`$lte` comparison — but the cast parses a bare
  `"YYYY-MM-DD"` string as **midnight UTC that day**. A `to=<today>` value
  therefore excludes every expense recorded *later* than midnight today —
  i.e., almost every expense recorded today. Confirmed with a plain script
  against backend's own code and now covered here: ER-10.
- `getExpenseTotalByCategory` uses a raw `.aggregate()` pipeline stage, which
  does not auto-cast at all — the string `to=<today>` is compared against a
  BSON `Date` and matches nothing, same failure mode as the fixed ObjectId
  bug, just for dates. Confirmed the same way. Covered here: ER-11.

Net effect: **the Dashboard's own "This month" period always sends `to =
today`, so both `GET /expenses` and `GET /expenses/summary` silently drop
today's expenses** — the exact case DJ-01 (`qa/e2e/tests/chat-dashboard-journey.spec.ts`)
exercises end to end. Not something QA can fix — both files are
`backend/dal/`, Adam's own code.

---

### ER-01 — `GET /categories` with no `Authorization` header → 401
- **Method:** `GET /categories`, no header.
- **Expected:** `401`.

### ER-02 — `GET /categories` returns only the logged-in user's categories
- **Method:** sign up two users (each gets their own 17-document default set via `seedDefaultCategories`). `GET /categories` as user A.
- **Expected:** `200`; exactly 17 categories, none belonging to user B (spot-check: every returned category's implicit ownership — verified by re-running as B and getting a disjoint id set).

### ER-03 — `GET /expenses` with no `Authorization` header → 401
- **Method:** `GET /expenses`, no header.
- **Expected:** `401`.

### ER-04 — `GET /expenses?from=&to=` narrows by date range
- **Method:** one user. `POST /chat/confirm` creates one expense (server stamps `date` = now, since the draft carries no explicit date). `GET /expenses?from=<tomorrow>&to=<tomorrow+1>` (a range that excludes today).
- **Expected:** `200 []` — today's expense falls outside the requested range.

### ER-10 — `GET /expenses` with `to=<today>` still includes an expense created today — FINDING: excluded
- **Method:** one user. `POST /chat/confirm` creates one expense (server stamps `date` = now). `GET /expenses?from=<today>&to=<today>`.
- **Expected per spec:** `200`, the expense is present (it falls inside today's range). **Actual (bug, see file header):** `200 []` — `to=<today>` casts to midnight UTC today, and the expense's real timestamp (created moments ago, later in the day) falls after that, so `$lte` excludes it.

### ER-05 — `GET /expenses` with no `from`/`to` returns everything for the user
- **Method:** same user, 2 expenses created via confirm. `GET /expenses` with no query params.
- **Expected:** `200`, both expenses present.

### ER-06 — `GET /expenses` is scoped to the logged-in user only
- **Method:** user A creates 2 expenses, user B creates 1. `GET /expenses` as user A.
- **Expected:** exactly 2 results, none matching B's expense id.

### ER-07 — `GET /expenses/summary` with no `Authorization` header → 401
- **Method:** `GET /expenses/summary`, no header.
- **Expected:** `401`.

### ER-08 — `GET /expenses/summary` totals match what was actually saved (no date filter)
- **Method:** one user. `POST /chat/confirm` creates two expenses on "Food" (10, 15) and one on "Transport" (7). `GET /expenses/summary` (no `from`/`to`).
- **Expected:** `200`; a row for "Food"'s id with `total === 25`, a row for "Transport"'s id with `total === 7`. Fixed — was the ObjectId-cast bug (see file header), now passes.

### ER-09 — `GET /expenses/summary` is scoped to the logged-in user only (no date filter)
- **Method:** user A creates one expense (5), user B creates one expense (100). `GET /expenses/summary` as user A.
- **Expected:** the returned rows total `5`, never `105` — B's spending never leaks into A's summary. Fixed, now passes.

### ER-11 — `GET /expenses/summary` with `to=<today>` still includes an expense created today — FINDING: excluded
- **Method:** one user. `POST /chat/confirm` creates one expense (amount 10, server-stamped `date` = now). `GET /expenses/summary?from=<today>&to=<today>`.
- **Expected per spec:** `200`, total `10`. **Actual (bug, see file header):** total `0` — the raw `.aggregate()` `$match` compares the bare string `to=<today>` against a BSON `Date` and never matches; this is the dashboard's own default query shape, so `GET /expenses/summary` is still effectively broken for every real dashboard request even though the ObjectId half is fixed.
