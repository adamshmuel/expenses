# Test specs — design before automation

Each file here is the **design-time** half of the QA work: for every planned test,
a stable ID, its purpose (the property of the system it proves), what is under
test, the method (setup + exact inputs + action), and the expected result.

The automation in `qa/tests/` is written **after** these and cites the IDs. The
HTML report inlines each test's full case from here.

| Spec file | Area | Level | Test IDs |
|---|---|---|---|
| `unit-userService.md` | `bl/userService.js` | unit | US-01 … US-19 |
| `unit-requireAuth.md` | `middleware/requireAuth.js` | unit | RA-01 … RA-09 |
| `unit-errorHandling.md` | `error_handling.js` | unit | EH-01 … EH-11 |
| `int-logger.md` | `.config/logger.js` | integration | LG-01 … LG-07 |
| `int-models.md` | `models/*.js` | integration | MD-01 … MD-20 |
| `int-db.md` | `.config/db.js` | integration | DB-01 … DB-03 |
| `int-startup.md` | `index.js` start-up | integration | ST-01 … ST-03 |
| `api-signup.md` | `POST /users/signup` | api | SU-01 … SU-12 |
| `api-login.md` | `POST /users/login` | api | LI-01 … LI-09 |
| `api-refresh.md` | `POST /users/refresh` | api | RF-01 … RF-09 |
| `api-logout.md` | `POST /users/logout` | api | LO-01 … LO-05 |
| `api-crosscutting.md` | error contract, headers, CORS, 404, secret-leak, middleware order | api | XC-01 … XC-14 |
| `e2e-auth-journey.md` | real client + real server, browser-driven | e2e | UJ-01 … UJ-02 |
| `unit-categoryService.md` | `bl/categoryService.js` | unit | CS-01 … CS-13 |
| `unit-expenseService.md` | `bl/expenseService.js` | unit | ES-01 … ES-09 |
| `unit-ai.md` | `backend/ai/` (prompt, schema, parseMessage) | unit | AI-01 … AI-12 |
| `int-categoryModel.md` | `models/categoryModel.js` middleware hooks | integration | CH-01 … CH-16 |
| `int-categoryService.md` | `bl/categoryService.js` — `seedDefaultCategories`, `resetToDefaults` | integration | CI-01 … CI-04 |
| `int-expenseService.md` | `bl/expenseService.js` — `createManyExpenses` | integration | EI-01 … EI-02 |
| `int-expenseCategoryDal.md` | `dal/categoryRepository.js` + `dal/expenseRepository.js` additions | integration | DL-01 … DL-10 |
| `api-chat-confirm.md` | `POST /chat/confirm` | api | CC-01 … CC-12 |
| `api-chat-messages.md` | `GET`/`POST /chat/messages` | api | CM-01 … CM-06 |
| `api-expenses-categories.md` | `GET /expenses`, `/expenses/summary`, `/categories` | api | ER-01 … ER-11 |
| `e2e-chat-dashboard-journey.md` | chat → dashboard, real client + real server, browser-driven | e2e | FJ-01, DJ-01 |
| `v2-chat-questions-2026-09-17.md` | **V2** — asking the chat about past spending. Designed against `docs/specs/10` + `11` **before the feature exists**; no case is exploratory | mixed (48 of 67 browser) | Q-01 … Q-67 |

**Governing specs:** `docs/specs/01-ai-chat.md`, `02-dashboard.md`, `03-api-contract.md`,
`04-data-model.md`, `05-user-layers.md`, `06-server-modules.md`, `07-server-entry.md`,
`08-expense-category-dal.md`, `09-expense-category-service.md`,
`10-chat-questions.md`, `11-chat-questions-server.md`.

## Spec changes this design work produced

Design-before-build earned its place on V2: twelve gaps in `docs/specs/10`/`11`
were found by writing the cases, **before a line of the feature existed**.
Eleven were accepted, one rejected, and all twelve are recorded in
`v2-chat-questions-2026-09-17.md` §6 with their rulings. Two are worth knowing
about from here:

- **A main category matched nothing.** As first specified, *"how much did I
  spend on Food this month"* — the spec's own headline example — would have
  answered "I found no expenses" on an account holding forty coffees, because
  expenses are filed on the subcategory. Now ruled: a category means that
  category and everything under it, matching what `/dashboard` already does.
- **`queryExpenses` built an unescaped regular expression from user text.** A
  **live V1 defect**, not a V2 one: *"change the expense at C++ (Tel Aviv) to
  90"* threw inside the DAL, and `.*` matched the whole account. Fixed in
  `9c151e5`. The 225-test V1 suite never sent a metacharacter — the hole was
  found by writing down what the input space is, not by running anything.

## Known spec divergences these tests will surface

| ID | Governing clause | Spec says | Code does | Test outcome |
|---|---|---|---|---|
| RA-06 | 06 §4 step 3 | verify-failure body `{ error: "Not authenticated." }` | `{ error: "Invalid or expired token!" }` | **PASS** — the test asserts the code's current wording (updated before this pass), not the spec's; the wording gap itself is still open |
| XC-11 | 07 §4 | 404 body `{ error: "Not found." }` | `{ error: "Not Found" }` | **PASS** — same: test asserts current wording, spec-wording gap still open |
| XC-13 | 07 §2 | `helmet()` is middleware #1 | `compression()` is #1, `helmet()` #2 | PASS with a recorded design note (helmet still covers every response) |
| EH-05 | 06 §3.2 | 409 body `{ error: "<field> already exists." }` | `{ error: "That username or email is already taken." }` | PASS on shape + status; wording divergence recorded as a note |

## Findings, fixed since the 2026-09-15 pass

| ID(s) | What | Root cause | Fix |
|---|---|---|---|
| CH-01..CH-16, CI-03/04, DL-03, CC-08..CC-11 | Every single-document `Category` write (`.save()`, `findOneAndUpdate`, `findOneAndDelete`, `deleteMany`) threw `TypeError: next is not a function` | `backend/models/categoryModel.js`'s four `pre(...)` hooks were declared `async function (next) {...}` and called `next()`/`next(err)` inside an async function — Mongoose does not supply a callable `next` to an async hook. | Dropped the `next` parameter; `throw` instead of `next(err)`, bare `return` instead of `next()`. All 16 hook tests plus the 6 tests that depended on them now pass. CC-08..CC-11 were rewritten from "asserts the 500" to asserting the correct `200` success shape (see `api-chat-confirm.md`). |
| ER-08, ER-09 (no date filter) | `GET /expenses/summary` always returned `[]` | `expenseRepository.getExpenseTotalByCategory` built `{ user: userId }` (a plain string) for a raw `.aggregate()` `$match` stage — not auto-cast to `ObjectId` the way `Model.find()` is. | Wrapped `new mongoose.Types.ObjectId(userId)`. Both tests now pass. |
| `resetToDefaults` (CI-03/04, previously masked by the hook bug) | Every expense ended up pointing at a **deleted** category id after a reset | Old order: find old "Other" → reassign expenses to it → delete **all** categories (including that old "Other") → reseed. The reassignment target was deleted a step later. | Reordered: delete old categories first → seed new defaults → find the **new** "Other" among them → reassign expenses to the new "Other"'s id. |
| ER-10, ER-11, DJ-01 | `GET /expenses` and `GET /expenses/summary` both silently dropped an expense recorded **today** whenever the request included `to=<today>` | A second, separate instance of the same "raw date/aggregate comparison isn't cast correctly" bug class that ER-08/09 caught for `ObjectId`s — this time for dates. `queryExpenses` (`Model.find()`) auto-cast the bare `"YYYY-MM-DD"` string to **midnight UTC that day**, so `$lte` excluded anything recorded later the same day; `from` wasn't cast either. `getExpenseTotalByCategory` (raw `.aggregate()`) didn't cast at all, so a string `to`/`from` never matched a BSON `Date`. | Both functions now wrap `from`/`to` with `startOfDay`/`endOfDay` helpers (UTC-based) before comparing against the `date` field. ER-10, ER-11, and the end-to-end DJ-01 all now pass. |

## New findings, still open (this pass)

None. All 4 previously-open bugs are fixed and re-verified.

## Test-code fix, this pass (not a product bug)

DJ-01 (`qa/e2e/tests/chat-dashboard-journey.spec.ts`) used bare `page.getByText(...)` locators for the total figure and each category name. `DashboardPage.tsx` renders the total in two places by design (the top summary card and the category list's own total row) and each category name in two places by design (the "By category" breakdown and the "Recent expenses" table) — so the un-scoped locators were a Playwright strict-mode violation, not a product bug. Fixed by scoping to `.dashboard-totals__figure` for the total and to the "By category" region for category names.
