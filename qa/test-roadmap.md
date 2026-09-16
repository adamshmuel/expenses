# Test roadmap — Expenses backend + chat/dashboard

_State: items 1-21 (auth surface) have test specs and automation, delivered
2026-09-10/11. Items 22-33 (chat, expense/category DAL/BL, `backend/ai/`,
the chat+dashboard client↔server journey), plus the Dashboard, now **all
have test specs and automation** — delivered 2026-09-15, see "Delivered
(third run, 2026-09-15)" below. Four real bugs were found and fixed across
that date's passes (categoryModel.js hooks, getExpenseTotalByCategory
ObjectId cast, resetToDefaults ordering, and a same-day date-range cast bug)
— all fixed, committed, and re-verified as of "Delivered (fifth run,
2026-09-15)" below. See `qa/specs/README.md` for the full before/after.
`backend/package.json` `test` is a stub; the QA package at `qa/` is a
standalone Vitest project. Client logic already has Vitest + RTL coverage in
`client/` and is not re-tested here._

Ordering: risk desc, then effort asc, within each delivered batch.

## Delivered (first run, 2026-09-10)

All 20 roadmap items below have test specs (`qa/specs/*.md`) and automation
(`qa/tests/`). First run: **119 passed / 2 failed / 0 skipped (121 tests)**.
The 2 failures are the deliberate spec-assertion divergences **RA-06** and
**XC-11** (see the table at the bottom of `qa/specs/README.md` and the run
report). One further behaviour, **finding F-1** (test LI-10, passing), was
surfaced during the run. Report: `qa/reports/latest.html`.

## Delivered (second run, 2026-09-11 — no backend/client code changed; added e2e)

Re-derived the testing-reference inventory against the current tree: no diff
since the first run (`git diff --stat e48ce5b -- backend/... client/src` is
empty), so items 1–20 were **re-run, not re-designed**. The code is unchanged
from the first run.

New this run — item 21, the two client+server journeys the client testable-
surface file flagged as "worth automating now": UJ-01 (signup → `/home` →
survive a reload → logout → `/home` redirects back to `/login`) and UJ-02
(wrong password → generic message → correct password succeeds). Real Chromium
browser, real Vite client (port 5174), real server (port 3100), same
`expenses_qa_test` isolation as the rest of `qa/`.

Combined totals this run: **121 passed / 2 failed / 0 skipped (123 tests)** —
the same 2 failures as the first run (RA-06, XC-11), plus the new UJ-01/UJ-02
both passing. Report: `qa/reports/latest.html`.

Environment note (not a code bug): the e2e config's `globalSetup` must not
spawn a synchronous child process (e.g. `execFileSync("lsof", ...)`, the
pattern `qa/harness/server.ts`'s `killPort()` uses for the vitest suite)
**before** Playwright starts its own `webServer`s — doing so was reproduced to
break network reachability to those servers for the rest of the run (browser
`page.goto` and even a plain `fetch()` get refused against ports the server's
own logs show as listening). `qa/e2e/globalSetup.ts` only drops the test DB
for this reason; see the comment there. If a stale process is ever left on
port 3100/5174 from an aborted run, `reuseExistingServer:false` will say so
clearly — free the port by hand and rerun. See
`qa/specs/e2e-auth-journey.md`.

## Blockers to clear first

| # | Item | Why it blocks | Effort | Owner |
|---|---|---|---|---|
| B1 | `backend/index.js` calls `app.listen()` unconditionally and does **not** `module.exports = app` | No in-process `supertest(app)`. API tests must spawn `node backend/index.js` as a child process and hit it over HTTP. | done (harness spawns child) | Adam (if in-process testing ever wanted) |
| B2 | `backend/` is unwritable by QA (`protect-backend.py`) | Cannot add an `app` export, test hooks, or fixtures to the server. All test code lives in `qa/`. | worked around | — |
| B3 | `MONGODB_URI` in `backend/.env` has no database name in the path → running server uses Mongoose default DB `test` (Adam's dev data) | Tests must not touch dev data. | done (harness rewrites URI to `/expenses_qa_test`, drops it on teardown) | — |
| B4 | No `.env.example` committed | Specs 06 §5 and 07 §6 require it. A fresh checkout can't configure the server. QA cannot create it (it would live under `backend/`). | **STILL OPEN — Adam-only** | Adam |
| B5 | Access token TTL 15 min, refresh 7 d | "Expired token" cases can't wait for real expiry. | done (tests sign short/expired tokens with the real secrets from `.env`) | — |
| B6 | No local `mongod`/`mongosh`; DB is Atlas | Can't use `mongodb-memory-server` offline without a download; harness uses the real Atlas cluster with a throwaway DB name. | worked around | — |
| B7 | `routes/chatRoute.js` calls `ai.parseMessage` directly (`require('../ai/index.js')`), with no seam to inject a fake client the way `backend/ai/parseMessage.js`'s own unit tests do (`options.client`) | An API-level test of `POST /chat/messages` would call the real Gemini Flash Lite API — cost, non-determinism, needs `GEMINI_API_KEY`. `POST /chat/confirm` never calls the AI at all (confirmed by reading the route), so it does **not** depend on B7 — fully covered (item 28). | **PARTIALLY WORKED AROUND**: `POST /chat/messages` is covered for GET history + the auth boundary only (`qa/specs/api-chat-messages.md`); its AI-dependent parsing behaviour is not tested at the API level. One real, minimal, deliberate Gemini call is made instead at the E2E level (`FJ-01`, headed so it can be watched) to prove the whole loop works at least once. Still an open decision for Adam: (a) intercept the outbound Gemini HTTP call from within `qa/`, or (b) add an injectable-client seam to `chatRoute.js` himself, if broader API-level coverage of `/chat/messages` is wanted later. | TBD |

## Roadmap

| # | Target (file) | Level | What the test asserts | Risk | Effort | Depends on | Test spec |
|---|---|---|---|---|---|---|---|
| 1 | `backend/bl/userService.js` — `issueTokenPair` (via signup/login/refresh) | unit | access payload is exactly `{ id, username }` (+ iat/exp), refresh payload is exactly `{ userId }`, the two secrets differ, refresh row saved with `expiresAt` ≈ now+7d | 3 | 1 | — | `qa/specs/unit-userService.md` (US-*) |
| 2 | `backend/bl/userService.js` — `login()` | unit | correct creds → `{ user, accessToken, refreshToken }`; unknown user **and** wrong password both throw one `Error` with `.status=401` and message `"Username or password is incorrect."` (no leak of which) | 3 | 1 | — | `qa/specs/unit-userService.md` |
| 3 | `backend/bl/userService.js` — `refresh()` | unit | happy path: old row deleted, new pair issued, same user; unknown token → 401 `"not recognized"`; `jwt.verify` failure propagates; old token cannot be used twice | 3 | 1 | — | `qa/specs/unit-userService.md` |
| 4 | `backend/bl/userService.js` — `signup()` | unit | password is bcrypt-hashed before `createUser`; token pair issued; return shape; a repository `E11000` throw propagates unchanged | 3 | 1 | — | `qa/specs/unit-userService.md` |
| 5 | `backend/bl/userService.js` — `logout()` | unit | calls `deleteRefreshToken` with the token; `undefined`/absent token is a safe no-op (no throw) | 2 | 1 | — | `qa/specs/unit-userService.md` |
| 6 | `backend/middleware/requireAuth.js` | unit | no header → 401 `{error:"Not authenticated."}`, `next` not called; malformed header → 401; **valid token → `req.user` is exactly `{id,username}`** (no iat/exp), `next()` once; expired / tampered / wrong-secret → 401; no DB touched. **SPEC DIVERGENCE:** spec 06 §4 step 3 says the verify-failure body must be `{error:"Not authenticated."}`; code returns `{error:"Invalid or expired token!"}` — test asserts the spec, expected to FAIL. | 3 | 1 | B5 | `qa/specs/unit-requireAuth.md` (RA-*) |
| 7 | `backend/error_handling.js` — `catchAsync` | unit | a rejecting handler → `next(err)` with the same error; a resolving handler → `next` not called; nothing logged by `catchAsync` itself | 2 | 1 | — | `qa/specs/unit-errorHandling.md` (EH-*) |
| 8 | `backend/error_handling.js` — `errorHandler` | unit | `err.code===11000` → 409 + `{error}` shape + `logger.warn`; `err.status` set → that status + `{error: err.message}` + `logger.warn`; otherwise → 500 + `{error:"Something went wrong."}` + `logger.error`, and **`err.message` never in the body**; body is always exactly `{error}` | 3 | 2 | — | `qa/specs/unit-errorHandling.md` |
| 9 | `backend/.config/logger.js` | integration (temp log dir) | an `error` line → `error.log` **and** `app.log`; a `warn` line → `app.log` but **not** `error.log`; a line with `{area:"ai"}` → `ai.log`; a line without → **not** in `ai.log`; empty meta prints no trailing `{}` | 2 | 2 | — | `qa/specs/int-logger.md` (LG-*) |
| 10 | `POST /users/signup` | api | 201; body `{ user:{id,username,email}, accessToken }` — **no `password`, no `createdAt`, no `refreshToken`**; `Set-Cookie: refreshToken=…; HttpOnly; SameSite=Lax; Max-Age=604800; Path=/`; 400 `{errors:[{field,message}]}` on bad body (username 3–20, valid email, password ≥ 8) with `field` matching the body key; 409 `{error}` on a duplicate that races the validator | 3 | 2 | B1,B3 | `qa/specs/api-signup.md` (SU-*) |
| 11 | `POST /users/login` | api | 200 + same body + cookie as signup; 400 `{errors:[]}` when `username`/`password` missing; 401 `{error:"Username or password is incorrect."}` for wrong username **and** wrong password (identical body); 429 `{error}` after 5 attempts / 15 min / IP | 3 | 2 | B1,B3 | `qa/specs/api-login.md` (LI-*) |
| 12 | `POST /users/refresh` | api | no cookie → 401 `{error}`, **not** written to `error.log`; valid cookie → 200 `{user,accessToken}` + a **new** `Set-Cookie`; used/rotated/tampered cookie → 401 + cookie cleared; the previous refresh token stops working after one successful rotation; `RefreshToken` collection net-zero growth per rotation | 3 | 3 | B1,B3 | `qa/specs/api-refresh.md` (RF-*) |
| 13 | `POST /users/logout` | api | 204 no body; `Set-Cookie` clears `refreshToken`; still 204 when no cookie sent; the token no longer works on `/refresh` afterwards | 2 | 2 | B1,B3 | `qa/specs/api-logout.md` (LO-*) |
| 14 | Cross-cutting: error contract, no-secret-leak, cookie-only refresh, security headers, CORS, 404 | api | every error body is `{error}` or `{errors:[{field,message}]}` and nothing else; no body on any endpoint contains `password` / bcrypt hash / `refreshToken`; helmet headers (`X-Content-Type-Options: nosniff`, CSP, etc.) on every response incl. errors; `Access-Control-Allow-Origin: http://localhost:5173` (exact) + `Access-Control-Allow-Credentials: true`; unmatched path → 404. **SPEC DIVERGENCE:** spec 07 §4 says 404 body is `{error:"Not found."}`; code returns `{error:"Not Found"}` — test asserts spec wording, expected to FAIL (or be recorded as a soft-wording note). | 3 | 3 | B1,B3 | `qa/specs/api-crosscutting.md` (XC-*) |
| 15 | `backend/models/userModel.js` | integration | `username` required, unique, 3–20, trimmed; `email` required, unique, lowercased, must pass `validator.isEmail`; `password` required; `createdAt` defaults to ~now; `toJSON` exposes the `id` virtual | 2 | 2 | B3 | `qa/specs/int-models.md` (MD-*) |
| 16 | `backend/models/refreshTokenModel.js` | integration | `token` required + unique; `user` required ObjectId ref; `expiresAt` required; a **TTL index** exists on `expiresAt` with `expireAfterSeconds: 0`; an index on `user` exists | 2 | 2 | B3 | `qa/specs/int-models.md` |
| 17 | `backend/models/expenseModel.js` | integration | `amount` required, rejected at 0 and negative, accepted at 0.01; `store`/`description` optional; `date` required, defaults ~now; `category` + `user` required; a compound index `{ user: 1, date: 1 }` exists | 2 | 2 | B3 | `qa/specs/int-models.md` |
| 18 | `backend/.config/db.js` — `connectDB()` | integration (child process) | a good URI → connects, logs one `info` "connected to MongoDB"; a bad URI → logs `error` and the process exits non-zero; does not define models, does not seed | 2 | 3 | B3 | `qa/specs/int-db.md` (DB-*) |
| 19 | Start-up sequence (`index.js`) | integration (child process) | `dotenv` loads before anything reads `process.env` (server boots with `.env` values); server listens only after `connectDB()` is called; a failed DB connection exits the process rather than serving 500s | 2 | 3 | B1 | `qa/specs/int-startup.md` (ST-*) |
| 20 | Middleware order (`index.js`) | api | observable order effects: `helmet` headers present (so it ran), `cors` headers present, JSON body parsed, cookies parsed (refresh works), global rate-limit is looser than login's. **NOTE:** `compression()` is mounted before `helmet()` in the code; spec 07 §2 lists helmet as #1. Recorded as a design note — helmet still covers every response. | 1 | 2 | B1,B3 | `qa/specs/api-crosscutting.md` |
| 21 | Client + server auth journeys (`client/src/App.tsx`, `LoginPage`, `SignupPage`, `NavBar`, `ProtectedRoute`) | e2e | signup → `/home` logged in → reload → still logged in (refresh cookie, not localStorage) → logout → `/login` → direct `/home` bounces back; wrong password shows the one generic message, correct password then succeeds | 3 | 2 | B1,B3 | `qa/specs/e2e-auth-journey.md` (UJ-*) |
| 22 | `backend/bl/categoryService.js` — `createCategory`/`updateCategory`/`deleteCategory` | unit | two-level depth check (400), duplicate-name-under-same-parent check (409, with the rename-excludes-self case for update), protected-"Other" check (400) — each throws the service's own message before the model's hooks would | 3 | 1 | — | **delivered** — `qa/specs/unit-categoryService.md` (CS-01..CS-13) |
| 23 | `backend/bl/categoryService.js` — `resetToDefaults` | integration (needs Mongo) | order matters: delete old categories → reseed defaults → reassign every expense to the **new** "Other"; an expense that pointed at a deleted category ends up on the new "Other" (different `_id`), never orphaned | 3 | 2 | B3 | **delivered** — `qa/specs/int-categoryService.md` (CI-01..CI-04). All pass — the ordering bug (old finding) and the categoryModel.js hook bug it depended on (below) are both fixed. |
| 24 | `backend/bl/expenseService.js` — `resolveCategory` (private, exercised via the four exports) | unit | zero-match → 400 "No category named..."; more-than-one-match → 400 with `candidates` (two different mains each with a same-named subcategory — spec 09 §8 confirms in scope); exactly one → returns it | 3 | 1 | — | **delivered** — `qa/specs/unit-expenseService.md` (ES-01/ES-02) |
| 25 | `backend/bl/expenseService.js` — `createManyExpenses` | integration | one bad category name in a multi-draft batch → **nothing** from the batch is saved (no partial save) | 3 | 2 | B3 | **delivered** — `qa/specs/int-expenseService.md` (EI-01/EI-02) |
| 26 | `backend/bl/expenseService.js` — `editExpense`/`deleteExpense` | unit + integration | ownership check via `findExpenseById` (not `queryExpenses` again) → 404 on wrong owner or missing id; `changes.category` as a name resolves to an id before update | 3 | 1 | — | **delivered** — `qa/specs/unit-expenseService.md` (ES-04..ES-08) |
| 27 | `backend/models/categoryModel.js` hooks (`pre("save")`, `pre("findOneAndUpdate")`, `pre("findOneAndDelete")`, `pre("deleteMany")`) | integration | two-level depth rejected on create/update; protected-"Other" rejected on rename/delete; cascade-to-"Other" reassignment fires on both a subcategory delete and a main-category delete (subs deleted too); the single-key `{owner}` `deleteMany` exception lets a real reset through while any other shape still rejects a batch containing a protected category | 3 | 2 | B3 | **delivered** — `qa/specs/int-categoryModel.md` (CH-01..CH-16). All 16 pass. **Fixed** (was a real bug: every hook threw `TypeError: next is not a function` — an async hook calling a `next` callback Mongoose never supplies). See `qa/specs/README.md`. |
| 28 | `POST /chat/messages`, `POST /chat/confirm` | api | request one never writes the actual change, only the two chat messages; request two's 7-branch intent switch calls the right service function with `req.user.id`; `create-expense`'s `drafts.length>1` boundary; matches/searches are scoped to the logged-in user only; a `backend/ai/` 502 propagates as a clean 502 response. | 3 | 3 | B1,B3,B7 | **delivered, partial** — `/chat/confirm` fully covered (`qa/specs/api-chat-confirm.md`, CC-01..CC-12), all pass; CC-08..11 now assert the real success shape (was: confirmed the categoryModel.js bug, fixed since). `/chat/messages` covered only for GET history + auth boundary (`qa/specs/api-chat-messages.md`, CM-01..CM-06) — request one's AI-dependent behaviour stays blocked on B7 (not worked around; see the E2E note for FJ-01, the one real AI call this pass). |
| 29 | `backend/dal/categoryRepository.js`, `backend/dal/expenseRepository.js` | integration | each function's documented behaviour (see the new DAL rows in the server testable-surface file) — `queryExpenses`'s `from`/`to`/`text` filter combinations, `getExpenseTotalByCategory`'s aggregation correctness, `reassignExpensesToCategory` scoping | 2 | 2 | B3 | **delivered** — `qa/specs/int-expenseCategoryDal.md` (DL-01..DL-10). All pass — DL-03 fixed (was the categoryModel.js hook bug). |
| 30 | `GET /expenses`, `GET /expenses/summary`, `GET /categories` | api | scoped to `req.user.id`; `/summary` skips the service layer (sanctioned by spec 09 §5); malformed `from`/`to` query-string behaviour | 2 | 2 | B1,B3 | **delivered** — `qa/specs/api-expenses-categories.md` (ER-01..ER-11). All pass — ER-08/09 (ObjectId cast) and ER-10/ER-11 (same-day date-boundary cast) were both real bugs, both fixed and re-verified. See `qa/specs/README.md`. |
| 31 | `backend/ai/parseMessage.js`, `prompt.js`, `schema.js` | unit | already substantially covered by Adam's own `__tests__/parseMessage.test.js` (9 tests, fake-client pattern) — `qa/` adds: the actual prompt/schema sent to `generateContent` matches `buildPrompt`/`responseSchema`'s output; `getDefaultClient()`'s lazy-singleton behaviour; `INTENTS` is the single shared source for both `prompt.js` and `schema.js`'s enum | 2 | 1 | — | **delivered** — `qa/specs/unit-ai.md` (AI-01..AI-12) |
| 32 | `bl/userService.js` — `signup()`'s new `seedDefaultCategories` call | integration | a successful signup leaves the user with exactly 8 main + 9 sub default categories already saved | 2 | 1 | B3 | new — add to `qa/specs/unit-userService.md` |
| 33 | Client ↔ server chat + dashboard journey: type an expense → confirm → see it on the dashboard | e2e | the flagship journey — proves "chat is the only place anything changes; dashboard always refetches" end to end. | 3 | 3 | B1,B3,B7 | **delivered** — `qa/specs/e2e-chat-dashboard-journey.md`. FJ-01 (real chat UI + one real, deliberate Gemini call) and DJ-01 (dashboard reflects seeded data) both PASS. DJ-01's locators were also fixed (see fifth run below — the total and category names each legitimately appear twice on the page). |

## Delivered — inventory only (2026-09-15, first pass this date)

No test automation was written or run this pass. This was purely re-deriving
`docs/reference/testing-reference/` against everything built since the last QA
run (2026-09-11, commit `e48ce5b`/`6c48c9d`): the chat feature (`backend/ai/`,
`backend/bl/categoryService.js` + `expenseService.js`, the expense/category
DAL, `routes/chatRoute.js`/`expensesRoute.js`/`categoriesRoute.js`, and the
client's `chatApi.ts`/`HomePage.tsx`/`chatSlice.ts`), plus the dashboard
feature (`client/src/api/dashboardApi.ts`, `DashboardPage.tsx`, `types.ts`,
`index.css`), which was **still uncommitted** as this pass ran — see
`docs/reference/testing-reference/2026-09-11-client-testable.md`'s Derivation
state. Items 22-33 below are new roadmap entries derived from that inventory;
none have test specs or automation yet — that is the next pass's job. See:

- `docs/reference/testing-reference/2026-09-15-ai-testable.md` (new file)
- `docs/reference/testing-reference/2026-09-11-server-testable.md` (updated)
- `docs/reference/testing-reference/2026-09-11-client-testable.md` (updated)

## Delivered (third run, 2026-09-15, this pass) — items 22-33 + Dashboard

Test specs and automation written and run for every item above, plus the
Dashboard (still uncommitted in the working tree when this pass started, per
Adam's explicit instruction to test it now regardless — see
`docs/reference/testing-reference/2026-09-15-client-additions-testable.md`
Part B). New spec files: `unit-categoryService.md`, `unit-expenseService.md`,
`unit-ai.md`, `int-categoryModel.md`, `int-categoryService.md`,
`int-expenseService.md`, `int-expenseCategoryDal.md`, `api-chat-confirm.md`,
`api-chat-messages.md`, `api-expenses-categories.md`,
`e2e-chat-dashboard-journey.md` — 12 new test-ID groups (CS, ES, AI, CH, CI,
EI, DL, CC, CM, ER, FJ, DJ), 122 new tests. Plus one new unit test (US-19) on
the pre-existing `unit-userService.md`, closing item 32.

**Two real bugs found** (not spec-wording divergences — genuine breakage; see
`qa/specs/README.md` "Findings from this pass" and the run report for full
detail, root cause, and a suggested fix for each):

1. **`backend/models/categoryModel.js`'s four middleware hooks throw on every
   call.** Every create/edit/delete/reset-categories chat action returns 500.
   22 tests fail against this (CH-01..16, CI-03/04, DL-03; CC-08..11 pass by
   confirming the 500). Confirmed independently of this harness with a plain
   `node -e` script against backend's own code.
2. **`GET /expenses/summary` always returns `[]`.**
   `expenseRepository.getExpenseTotalByCategory`'s raw aggregate `$match`
   never casts the string `req.user.id` to `ObjectId`. Ship-blocking for the
   Dashboard: `DashboardPage.tsx`'s `total` is always `0`, so the screen
   always shows its empty state regardless of real data — proven with a real
   browser in DJ-01 (ER-08, ER-09, DJ-01 fail against this).

Both are in `backend/` outside `ai/` — Adam's own code. QA does not edit
`backend/`; these are reported, not fixed, here.

**Also found and fixed in `qa/`'s own test code** (not app bugs): the
pre-existing `unit-userService.md`/`userService.test.ts` broke because
`userService.signup` now calls the real `categoryService.seedDefaultCategories`
— fixed by stubbing that dependency too (and added US-19 to prove the call
happens). The pre-existing `int-models.md`/`models.test.ts` broke when run
alongside the new `categoryModel.test.ts` in the same single-fork Vitest
process — both required the same backend model file onto the same global
mongoose singleton, and `models.test.ts`'s cache-busting re-require threw
`OverwriteModelError`; fixed by dropping the unnecessary cache-bust (see the
comment now in `models.test.ts`).

One real (single, deliberate) Gemini API call is made in this pass, in
`e2e/tests/chat-dashboard-journey.spec.ts`'s FJ-01 — the flagship "type an
expense in chat, confirm, it's really saved" journey, run headed so it can be
watched. Everything else that needs `backend/ai/` behaviour uses the fake-client
injection seam (unit level) or is explicitly out of scope this pass (blocker
B7: `routes/chatRoute.js` has no seam to inject a fake AI client for an API-level
test of `POST /chat/messages`).

Full run: **197 passed / 22 failed / 0 skipped (219 tests)**. Report:
`qa/reports/latest.html`.

## Delivered (fourth run, 2026-09-15, same day — re-verify 3 backend fixes)

Adam fixed 3 real bugs in `backend/` (still uncommitted in the working tree —
no new commit hash) that the third run's 21 failures surfaced, plus Claude
added logging to `backend/ai/parseMessage.js` (also uncommitted). All 4
changes are pure fixes/additions to logic already inventoried in the
testable-surface files — no new rows needed there, only pass/fail status
changed. One small exception: `categoryRepository.deleteCategoriesByIds` was
added but is not currently called by anything; noted in
`2026-09-15-server-additions-testable.md`, no test added (nothing to test
yet).

**Fixed, now passing:**

1. `backend/models/categoryModel.js`'s four `pre(...)` hooks — dropped the
   `next` parameter, used `throw`/`return` instead of `next(err)`/`next()`.
   CH-01..16, CI-03/04, DL-03 (23 tests) now pass.
2. `backend/dal/expenseRepository.js`'s `getExpenseTotalByCategory` — wrapped
   `new mongoose.Types.ObjectId(userId)`. ER-08/09 (no date filter) now pass.
3. `backend/bl/categoryService.js`'s `resetToDefaults` — reordered to delete
   old categories → reseed → reassign to the *new* "Other". CI-03/04 confirm.

`qa/tests/api/06-chat-confirm.test.ts`'s CC-08..11 were rewritten from
asserting the old 500 ("FINDING" test names dropped) to asserting the spec's
real 200 success shape, per `docs/specs/09-expense-category-service.md` §4 —
all 4 now pass.

**New finding this pass, still open:** fixing the ObjectId cast exposed a
second, separate instance of the same bug class underneath it — for **dates**,
not ids. Neither `queryExpenses` (`GET /expenses`) nor
`getExpenseTotalByCategory` (`GET /expenses/summary`) build a real `Date` from
the `from`/`to` query-string params before comparing against the schema's
`Date` field: `Model.find()` auto-casts a bare `"YYYY-MM-DD"` to **midnight
UTC that day**, so `to=<today>` excludes anything recorded later the same
day; the raw `.aggregate()` in the summary function doesn't cast at all, so
`to=<today>` never matches. New tests ER-10/ER-11
(`qa/specs/api-expenses-categories.md`) prove both, and the e2e DJ-01 (now
run in full, alongside UJ-01/UJ-02/FJ-01, not just re-checked in isolation)
still fails for this new reason — same user-visible symptom (dashboard shows
its empty state for money spent today) as before, different root cause. Not
QA-owned; reported, not fixed. See `qa/specs/README.md` and the run report.

**Final counts, this run:** vitest 215 passed / 2 failed / 0 skipped (217
tests) + Playwright e2e 3 passed / 1 failed (4 tests) = **218 passed / 3
failed / 0 skipped across 221 tests**. All 3 failures are the new, understood,
documented ER-10/ER-11/DJ-01 finding — zero unexpected failures. Report:
`qa/reports/latest.html` (dated copy: `qa/reports/2026-09-15-2232.html`).

## Delivered (fifth run, 2026-09-15, same day — re-verify all 4 fixes + full regression)

All 4 bugs from the fourth run are now committed (`62cb457` fixes the
categoryModel.js/date/ObjectId/resetToDefaults bugs, `ece6439` adds AI-call
logging, `2d0d99e` commits the dashboard build). Re-verified each fix by
reading the actual diff against what the previous pass described, then
re-ran the affected tests plus the full suite:

1. **Date-boundary bug (ER-10, ER-11, DJ-01) — FIXED, confirmed.**
   `expenseRepository.js` now wraps `from`/`to` with `startOfDay`/`endOfDay`
   (UTC) helpers in both `queryExpenses` and `getExpenseTotalByCategory`,
   and `from` is cast too. ER-10/ER-11 pass. DJ-01 also passes, but only
   after a **test-code fix**: `page.getByText("₪ 50.00")` and
   `page.getByText("Food"/"Transport")` were unscoped locators, and
   `DashboardPage.tsx` legitimately renders the total figure twice (top
   summary card + category list's own total row) and each category name
   twice (the "By category" breakdown + the "Recent expenses" table) — a
   Playwright strict-mode violation in the test, not a product bug, exactly
   as flagged. Fixed by scoping to `.dashboard-totals__figure` and to the
   "By category" region. See `qa/e2e/tests/chat-dashboard-journey.spec.ts`.
2. **`getExpenseTotalByCategory` ObjectId cast (ER-08, ER-09) — FIXED,
   confirmed.** Already passing since the fourth run; re-confirmed this run.
3. **`categoryModel.js` next-callback bug (CH-01..16) — FIXED, confirmed.**
   All four hooks now `throw`/`return` instead of taking/calling `next`.
   Re-confirmed passing.
4. **`resetToDefaults` ordering bug — FIXED, confirmed.** Deletes old
   categories first, then seeds, then reassigns to the new "Other". CI-03/04
   re-confirmed passing.

**Full regression:** vitest 217/217 passed, Playwright e2e 4/4 passed
(UJ-01, UJ-02, FJ-01, DJ-01) — **221 passed / 0 failed / 0 skipped**, zero
regressions. One transient failure was seen and diagnosed, not counted as a
bug: FJ-01 (the one test that makes a real Gemini API call) failed once with
a Gemini-side `503 UNAVAILABLE "high demand"` logged to `backend/logs/ai.log`
via the new logging — confirmed external/transient by re-running immediately
after, which passed cleanly.

`qa/scripts/build-report.mjs` and `qa/scripts/testcases.mjs` had stale
hardcoded narrative (a `REAL_BUGS` list and prose describing ER-10/ER-11/DJ-01
as currently open) left over from the fourth run — updated to reflect the
fix, moved into the fixed-bugs table. `qa/specs/api-expenses-categories.md`
and `qa/specs/README.md` updated the same way. `docs/reference/testing-reference/`
derivation-state markers updated from "uncommitted working tree" to the real
commit hashes (`62cb457`, `ece6439`, `2d0d99e`) — no content changes needed,
the diffs already matched what was documented.

Report: `qa/reports/latest.html` (dated copy: `qa/reports/2026-09-15-2259.html`).

## Out of scope (and why)

- **Client auth modules** (`authApi.ts`, `httpClient.ts`, `authSlice.ts`, `LoginPage`/`SignupPage`/`NavBar`/`ProtectedRoute`) — already covered by `client/`'s Vitest suite. Not duplicated.
- **Client chat/dashboard modules already covered by `client/`'s own Vitest suite** (`chatApi.test.ts`, `chatSlice.test.ts`, `HomePage.test.tsx`, `dashboardApi.test.ts`, `DashboardPage.test.tsx`) — not duplicated here; items 22-33 below cover the *server-integrated* angle (real backend, not a mocked `httpClient`) and the pieces those client suites can't reach (`backend/ai/`, the DAL/BL layers, cross-cutting behaviour).
- **Category management CRUD route outside the chat** — deferred to v2 by product decision (`01-ai-chat.md` §10 "Decided and closed"); every category change goes through the chat instead.
- **Global rate limiter exact ceiling (300/15 min)** — would need 300+ requests; disproportionate. We assert only that a global limiter is present and looser than the login one.
- **`socket.io`, `axios`, `jsonfile`, `csurf`, `winston-daily-rotate-file`** — in `backend/package.json` but unused by any built code. `csurf` is deprecated; spec 07 says no CSRF in v1. Noted, not tested.
- **Real calls to Gemini Flash Lite** — cost, non-determinism, needs `GEMINI_API_KEY`. `backend/ai/parseMessage.js` tests inject a fake client (already true of Adam's own `__tests__/parseMessage.test.js`); an API-level test of `POST /chat/messages` needs its own decision on how to avoid a real network call — see the server testable-surface file's Known blockers.

## Not covered, accepted

- **HTTPS `secure: true` cookie path** — code hard-codes `secure: false` for local http (spec 05 §6.1 says `true` once on HTTPS). No HTTPS in v1; the `false` branch is what ships. Accepted.
- **TTL index actually deleting an expired row** — MongoDB's TTL reaper runs ~every 60 s; asserting real deletion would make the suite slow and flaky. We assert the index *definition* only (MD-* checks `expireAfterSeconds: 0` on `expiresAt`).
- **`exception.log` / `rejection.log` crash handlers** — would require crashing the process mid-suite. We assert the handlers are configured on the logger instance (LG-* inspects `logger.exceptions`/transports), not that a real uncaught throw lands there.
- **Concurrency / race on the duplicate-key 409** — we simulate the race by disabling the async validator path (posting a duplicate that the unique index catches), not by true parallel requests.
