# Server additions since the last QA pass — reference

Not a spec. Everything added to `backend/` (outside `ai/`, which has its own
file) since the last QA run derived `2026-09-11-server-testable.md` against
commit `e48ce5b`. That file is **not edited** here — per
`.claude/rules/testing-reference.md`, Claude never edits an existing dated
file in this folder, so it can't be silently invisible to `qa`'s own change
tracking. This is a new file instead, covering only what's new.

None of this has been run or tested yet. It's an inventory, not a QA report.

## Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| `backend/bl/categoryService.js`, `backend/bl/expenseService.js`, `backend/dal/categoryRepository.js` (additions), `backend/dal/expenseRepository.js` (additions), `backend/models/categoryModel.js` (hooks added), `backend/models/messageModel.js` (new), `backend/routes/chatRoute.js`, `backend/routes/expensesRoute.js`, `backend/routes/categoriesRoute.js`, `backend/constants/defaultCategories.js` | commit `60c12e2` + uncommitted working-tree fixes (2026-09-15, second pass) | First derivation 2026-09-15. Second pass same day: re-checked after Adam fixed 3 bugs (categoryModel.js hooks, getExpenseTotalByCategory ObjectId cast, resetToDefaults ordering) — still uncommitted, no new commit hash. Diff is a pure bugfix (`git diff backend/bl backend/dal backend/models`) except one small addition: `categoryRepository.deleteCategoriesByIds`, noted below, not yet called by anything. No rows needed re-deriving; only pass/fail status changed. `git diff --stat e48ce5b -- backend/bl backend/dal backend/models backend/routes` for the full history. |

All of this is **committed** (not in-progress) — safe to write automation
against as-is.

## `bl/categoryService.js` — business logic (new)

| Export | Does | Invites |
|---|---|---|
| `getForUser(userId)` | all categories a user owns | unit (repo mocked): passes userId through |
| `findByName(userId, name, parentId?)` | case-insensitive name match, optionally scoped to a parent | unit: case-insensitivity; zero/one/several matches; parent scoping narrows correctly |
| `createCategory(userId, {name, parent?})` | validates parent exists/owned/is-a-main-category, rejects duplicate name under same parent, else creates | unit: 400 on missing/foreign parent; 400 on a parent that itself has a parent (3-level rejection); 409 on duplicate name under same parent; happy path passes `parent: null` when omitted |
| `updateCategory(userId, id, {name})` | 404 if not found/not owned; 400 if `isProtected` ("Other"); 409 if name collides with a sibling (excluding itself) | unit: all three error branches; the self-exclusion in the duplicate check (renaming to its own current name must not 409) |
| `deleteCategory(userId, id)` | 404 if not found/not owned; 400 if protected; else deletes (cascade is the model's job) | unit: both error branches; happy path delegates to repository |
| `seedDefaultCategories(userId)` | two-pass insert from `constants/defaultCategories.js`: mains first (real `_id`s), then subs referencing those ids | integration (needs Mongo, since it round-trips through `createManyCategories`): produces 8 mains + the right sub counts; "Other" comes out `isProtected: true`; sub `parent` ids match their intended main |
| `resetToDefaults(userId)` | reassigns all expenses to "Other" first, deletes all categories, reseeds | integration: expenses end up pointed at the (new) "Other" id, not orphaned; old category ids are gone; new set matches `seedDefaultCategories`'s shape |

Governed by: `docs/specs/09-expense-category-service.md` §2; category rules also in `docs/specs/04-data-model.md` "Category".

## `bl/expenseService.js` — business logic (new)

| Export | Does | Invites |
|---|---|---|
| `resolveCategory(userId, categoryNameOrId)` *(private)* | resolves a name to one category doc | unit: 0 matches → 400 "Create it first?"; 2+ matches → 400 with `candidates`; exercised only through the exports below, not directly importable |
| `getForUser(userId, filters)` | thin passthrough to `expenseRepository.queryExpenses` | unit: filters passed through unchanged |
| `createExpense(userId, draft)` | resolves `draft.category` (a name) to an id, then creates | unit (repo + resolveCategory path mocked, or integration): category-name → id resolution actually happens before save; propagates resolveCategory's 400s |
| `createManyExpenses(userId, drafts)` | resolves every draft's category **before** any write (`Promise.all` then one `insertMany`) | unit/integration: one bad category name in a batch of N fails the whole batch — **no partial save**; this "resolve-all-first" ordering is the one property worth a dedicated test, easy to regress |
| `editExpense(userId, id, changes)` | 404 if not found/not owned; if `changes.category` is present, resolves name→id first | unit: 404 branch; category-in-changes gets resolved, a changes object without `category` passes through untouched |
| `deleteExpense(userId, id)` | 404 if not found/not owned; else deletes | unit: 404 branch; happy path |

Governed by: `docs/specs/09-expense-category-service.md` §3.

## `dal/categoryRepository.js` — additions

| Export | Does | Invites |
|---|---|---|
| `findOtherCategory(userId)` | `Category.findOne({name:"Other", owner, parent:null})` | integration: finds the seeded "Other"; `null` if somehow absent |
| `createManyCategories(docs)` | `Category.insertMany(docs)` | integration: bulk insert round-trips correctly, including `parent` refs |
| `deleteCategoriesByUser(userId)` | `Category.deleteMany({owner})` | integration: only that user's categories are removed; exercises the model's `pre("deleteMany")` single-owner-reset exception (see model row below) |
| `deleteCategoriesByIds(ids)` | `Category.deleteMany({_id:{$in:ids}})` | added alongside the `resetToDefaults` bugfix (uncommitted); **not currently called by any code path** — `resetToDefaults` still uses `deleteCategoriesByUser`. No test yet; add one if/when a caller appears, or ask Adam whether it's dead code. |

(`getCategoriesByUser`, `findCategoryById`, `createCategory`, `updateCategory`, `deleteCategory` already existed before this pass and are unchanged.)

## `dal/expenseRepository.js` — additions

| Export | Does | Invites |
|---|---|---|
| `getExpenseTotalByCategory(userId, from?, to?)` | Mongo `$match`/`$group`/`$sum` aggregation, not a JS loop | integration (needs real Mongo — aggregation pipelines don't work against a mock): totals are correct per category; date range narrows correctly; a user with zero expenses gets `[]`, not an error |
| `findExpenseById(id)` | `Expense.findById(id)` | integration: match / `null` |
| `reassignExpensesToCategory(userId, categoryId)` | `Expense.updateMany({user}, {category})` — moves **every** expense of a user, not just some | integration: all of a user's expenses end up on the new category; another user's expenses are untouched |
| `queryExpenses` (signature changed) | now also takes `filters.text`, matched case-insensitively against `store` **or** `description` via regex `$or` | integration: text filter matches partial/case-insensitive; combines correctly with a date range (both narrow, not override) |

Governed by: `docs/specs/08-expense-category-dal.md`.

## `models/categoryModel.js` — new hooks

Four Mongoose middleware hooks were added since the last derivation. All were
dormant before (no route touched `Category`); now `categoryService` exercises
them. Best tested at the integration level (real Mongo) since they run
server-side on save/update/delete, not something you can unit-test by mocking
Mongoose cleanly.

| Hook | Rule | Invites |
|---|---|---|
| `pre("save")` | rejects `isProtected: true` on anything named other than "Other"; rejects a `parent` that doesn't exist or is itself a subcategory (blocks 3+ levels) | integration: each rejection path throws; a valid main or valid sub saves fine |
| `pre("findOneAndUpdate")` | blocks renaming/unprotecting a protected category; blocks setting a `parent` that doesn't exist or is itself a subcategory | integration: each of the three rejections; a normal rename of a non-protected category succeeds |
| `pre("findOneAndDelete")` | rejects deleting a protected category; otherwise reassigns that category's (and if it's a main, its subs') expenses to "Other" **before** deleting, then deletes the subs too | integration: protected-delete rejection; expenses land on "Other" after deleting a main category with subs and expenses on both; subs are gone afterward |
| `pre("deleteMany")` | rejects any bulk delete that would remove a protected category — **except** a filter of exactly `{owner: userId}` (the single-owner full reset used by `resetToDefaults`) | integration: a `deleteMany({owner, isProtected: false})`-style filter matching only unprotected categories succeeds; a broader filter that would catch "Other" is rejected; the exact single-key `{owner}` filter is let through even though it matches "Other" |

Governed by: `docs/specs/04-data-model.md` "Category"; `docs/specs/09-expense-category-service.md` §2 (reset).

## `models/messageModel.js` — new

| Field | Rule | Invites |
|---|---|---|
| `text` | required | integration: required-field rejection |
| `role` | required, enum `"user"`/`"assistant"` | integration: enum rejection on any other value |
| `author` | required ObjectId ref to `User` | integration: required-field rejection |
| `createdAt`/`updatedAt` | from `{timestamps: true}` | integration: both set on create; `updatedAt` changes on save (messages are read-only in practice — no route updates one, so this is a schema property, not an exercised path) |
| index `{author: 1}` | | integration: index exists (same style as other index assertions in the server file) |

Governed by: `docs/specs/01-ai-chat.md` (Message shape referenced, no dedicated data-model section — cross-check `docs/specs/04-data-model.md` if one gets added there).

## `constants/defaultCategories.js` — new

Plain data (8 entries: Food, Transport, Home, Health, Clothing, Entertainment, Education, Other — the last `isProtected: true`), not a model. No independent test value beyond what `seedDefaultCategories` already covers (a snapshot/shape test of this array itself would be low value — it's the input, not logic).

## `routes/chatRoute.js` — new

Mounted at `/chat`, behind `requireAuth` (per `backend/index.js`).

| Route | Does | Invites |
|---|---|---|
| `GET /chat/messages?limit=` | this user's most recent `limit` (default 50) messages, oldest-first (fetched newest-first, `.limit`, then reversed) | api: default limit 50; a smaller limit still returns oldest-first of the *most recent* N (off-by-one on the fetch-then-reverse is an easy regression to check); scoped to `req.user.id` only |
| `POST /chat/messages` | saves the user's message → calls `parseMessage` with the user's categories + last-30-days expenses → for `edit-`/`delete-expense` looks up matches via `expenseService.getForUser(searchFilters)`, for `edit-`/`delete-category` via `categoryService.findByName` → saves the assistant reply → returns `{reply, intent, drafts, draft, changes, matches}` | api: the 30-day window is a hardcoded cutoff worth asserting explicitly (an expense 31 days old should not appear in what's sent to the AI — this needs the AI call mocked/stubbed to inspect its arguments, can't assert through a real Gemini call in CI); each of the 7 intents produces the right shape of `matches` (or none for create/reset); both messages (user + assistant) are persisted even if the intent ultimately doesn't lead to a confirm |
| `POST /chat/confirm` | switches on `intent` from the request body, calls exactly one service function, returns `{changed}` | api: one test per intent branch (7 branches, including the `drafts.length > 1` batch-vs-single split inside `create-expense`); never calls the AI (this is the one thing worth explicitly asserting — mock `parseMessage` and confirm it's not invoked) |

Governed by: `docs/specs/01-ai-chat.md` §5, §6, §9; `docs/specs/09-expense-category-service.md` §4.

**Note:** neither route validates its request body before passing it to a
service — e.g. `/chat/confirm` trusts `req.body.intent` to be one of the seven
known strings; an unrecognized intent falls through the switch with `changed`
left `undefined` and still returns `200 {changed: undefined}`. Worth an
explicit test either way (confirms current behavior, or flags it as a gap to
raise with Adam — this route lives in `backend/routes/`, Adam's code, so a
change here needs his fix, not Claude's).

## `routes/expensesRoute.js` — new

Mounted at `/expenses`, behind `requireAuth`.

| Route | Does | Invites |
|---|---|---|
| `GET /expenses?from=&to=` | `expenseService.getForUser` with a date-range filter | api: date range narrows correctly; scoped to the logged-in user; omitted `from`/`to` returns everything |
| `GET /expenses/summary?from=&to=` | calls `expenseRepository.getExpenseTotalByCategory` **directly, skipping the service layer** (a deliberate exception — plain aggregation read, no rule to enforce, per the route's own comment) | api: same date-range behavior as above; worth confirming this really does skip any category-resolution/auth-beyond-requireAuth logic (there isn't any to skip, but that's the claim to verify) |

Governed by: `docs/specs/09-expense-category-service.md` §5.

## `routes/categoriesRoute.js` — new

Mounted at `/categories`, behind `requireAuth`.

| Route | Does | Invites |
|---|---|---|
| `GET /categories` | `categoryService.getForUser` | api: scoped to the logged-in user; returns both mains and subs flat (the client does the tree-building, per `dashboardApi.ts`/`DashboardPage.tsx`) |

Governed by: `docs/specs/09-expense-category-service.md` §5.

## `index.js` — mounting (grew, not re-derived in full)

Three new routers mounted (`/chat`, `/expenses`, `/categories`) alongside the
existing `/users`. Not re-deriving the whole server-entry file here — the
2026-09-11 file's rows for middleware order, CORS, security headers, etc. are
unaffected (new routers, not new middleware). Worth one cheap cross-cutting
check: the three new routers are *actually* behind `requireAuth` (a
no-token request to each returns 401, not a route-specific bug where
`requireAuth` was forgotten on mount).

## Not covered here (deliberately)

- **`backend/ai/`** — has its own file, `2026-09-15-ai-testable.md`.
- **Client changes** (chat UI, dashboard UI) — see
  `2026-09-15-client-additions-testable.md`.
- **`docs/specs/09-expense-category-service.md` §1 (layering) and §6+ (if any)** — not read in full for this pass; re-check when writing actual test specs, this file only maps what exists.

---

## Maintenance

This file is not re-derived automatically — per `.claude/rules/testing-reference.md`,
Claude writes this folder directly and does not invoke a subagent to update
it. When more server material ships, add another new dated file rather than
editing this one or the 09-11 file.
