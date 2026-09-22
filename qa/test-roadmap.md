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

---

## 2026-09-16 pass — the add-an-expense flow, after eleven bugs found by hand

**Task:** test the add-an-expense flow the way a real user performs it, after
`docs/reference/testing-reference/2026-09-16-manual-bugs-found.md` (bugs 1-6,
Finding A) and `2026-09-16-chat-flow-bugs-and-fixes.md` (bugs 7-11, "what qa
should take from this") recorded eleven bugs found by hand while every
existing automated test stayed green. Full four-question / flow-list
analysis: `qa/flow-analysis-2026-09-16.md` (written first, before any
inventory work, per process).

### New test classes added, and why (the two bug files' explicit lessons)

| Lesson from the bug-fix files | Class added | Where |
|---|---|---|
| "Test the user's goal, not the endpoint" — no test drove a real message through to a database row | Flow tests through the real UI, real server, occasional real AI, asserting stored fields | `qa/specs/e2e-chat-stress-flows.md`, `FS-01..FS-07` |
| "Assert stored values, not just status codes and row counts" (Finding A) | Field-level assertions on `expenses` and `messages`, not just amount/count/existence | `CC-02`/`CC-03` strengthened; new `CR-01`,`CR-03`,`CR-06` for the `messages` collection specifically |
| "Hold a conversation" — every existing chat test was one message long | Multi-turn E2E: missing field answered later, a correction mid-draft | `FS-01`, `FS-02` |
| "Exercise the AI→server contract" — `/chat/confirm` tests never touch a real AI-produced payload | `FJ-01` (pre-existing) already does this for the happy path; `FS-01..FS-04` extend it to incomplete/adversarial real-AI payloads | `qa/e2e/tests/chat-stress-flows.spec.ts` |
| "Cover the incomplete-input shapes" — every existing payload was complete and valid | Missing category, empty-string category, nonexistent category, ambiguous category name, one-bad-category-in-a-batch, create-category with a nonexistent/ambiguous parent name | `qa/specs/api-chat-confirm-resolution.md`, `CR-01..CR-08` |

**Re-checking what was already covered, per the same instruction** (a class
learned must be applied backwards, not just forward):
- `CC-02`/`CC-03` (`qa/tests/api/06-chat-confirm.test.ts`) were exactly
  Finding A's own "concrete example" of the gap — strengthened in place to
  check `store`, resolved `category` id, and `date`, not just `amount` and
  row existence.
- `qa/tests/unit/categoryService.test.ts`'s CS-05/06/07 and
  `qa/tests/unit/ai.test.ts`'s AI-01 were re-derived this pass (see "Harness
  bug found and fixed" below) — they had silently drifted from the real
  current implementation and were passing for the wrong reason.

### Harness bug found and fixed: cross-file require-cache pollution

Running the full suite after adding the new tests initially produced **29
failures** across files that were previously green and untouched by this
pass (`tests/integration/expenseCategoryDal.test.ts`,
`tests/integration/expenseService.test.ts`), with errors like
`expenseRepository.queryExpenses is not a function` and
`Cannot read properties of undefined (reading 'filter')`.

Root cause: `qa/harness/cjs-stub.ts`'s `loadCjsWithStubs` seeds Node's
`require.cache` with fake module records so a unit test's `require()` calls
resolve to stubs, and — per its own old comment — deliberately left those
stub entries "in place for the lifetime of the test file", on the assumption
that each test file runs in its own process. That assumption is false here:
`qa/vitest.config.ts` sets `fileParallelism: false` +
`poolOptions.forks.singleFork: true` (needed so every API test shares one
server and one in-memory rate limiter), so **all test files share one Node
process and one require cache**. A unit test stubbing
`dal/categoryRepository.js` or `dal/expenseRepository.js` was silently
handing its fake object to any *later* file's plain `require()` of the same
resolved path — exactly the "shared mutable state across tests" anti-pattern
`test-data-management` warns about, just at the module-loader level instead
of the database level.

**Fixed**: `loadCjsWithStubs` now records whatever was cached at each
resolved path (stub dependencies *and* the unit-under-test's own module)
before overwriting it, and restores those exact entries immediately after
the fresh module is built — the unit-under-test has already captured a
direct closure reference to the stub object by then, so nothing about the
test itself changes, only the leak stops. Full suite re-run clean:
**225/225 vitest tests passed** across all 23 files after the fix.

While fixing this, two existing unit tests were found to have drifted from
the real implementation independently (see re-derivation below) and are
corrected as part of the same pass:
- `categoryService.test.ts` CS-05/06/07 mocked `findCategoryById`, matching
  an older `createCategory` that resolved `parent` **by id**. Bug 9's fix
  changed it to resolve `parent` **by name** via `findByName` (the AI always
  sends a name, never an id — that mismatch was bug 9 itself). CS-06 is
  repurposed from an unreachable "parent owned by another user" scenario
  (impossible now that `findByName`'s search is already scoped to the
  calling user) to the previously-untested "ambiguous parent name" branch.
- `ai.test.ts` AI-01 asserted `buildPrompt` embeds `categories` verbatim;
  `buildPrompt` grew a `withParentNames` transform (same session's fixes)
  that resolves a subcategory's `parent` id to its main category's name
  before embedding, so a main category with no parent now serializes as
  `{name, parent: null}`, not the raw input shape.

Both are corrected in their `qa/specs/*.md` file, their test file, and
`qa/scripts/testcases.mjs`, each with a `divergence` note explaining the
correction rather than silently rewriting history.

### New bugs found by the new stress tests (not the ones this run set out to verify)

Both reproduced identically across two separate full runs — not flakes.

1. **Chat state leaks across logout/login (`FS-06`, failing, left in the
   suite).** Logging out and back in, in the same browser tab, does not
   clear `chatSlice`'s `pending` draft: `store.ts` combines `authReducer`
   and `chatReducer` independently, and `authSlice`'s `logout.fulfilled`
   only resets the `auth` slice. Since logout is a client-side SPA
   navigation (no full reload), a stale, unconfirmed draft from *before*
   logout is still visible and still confirmable after logging back in —
   potentially as a different user in the same tab. Flagged as a background
   task (`client/src/store/`, Claude's own code — not this session's to
   fix); not one of this run's two pre-declared open items.
2. **A numeric correction to a complete draft isn't always acknowledged
   (`FS-02`, failing, left in the suite).** "spent 30 on transport" → a
   complete draft; "actually make that 50" → the identical previous reply,
   unchanged — the exact failure `prompt.js`'s own correction rule calls out
   ("an identical reply to a pushback is the single worst failure here"),
   but for a plain numeric correction, a shape the rule's own examples
   (naming a different category, "I said X") don't explicitly cover.
   Flagged as a background task (`backend/ai/prompt.js`) to determine
   whether it needs an explicit example or is LLM noise worth more sampling
   first.

### Two test-locator bugs found and fixed while writing the new E2E tests (not product bugs)

- `FS-04` initially threw a Playwright strict-mode violation: the assistant
  echoed the user's own words back verbatim ("I see you spent 45 on a new
  bike, but..."), so an unscoped `getByRole("listitem").filter({hasText})`
  matched both bubbles. Fixed by scoping every "wait for the round trip to
  land" assertion to `.chat-bubble--user` specifically (`userBubble()`
  helper in `qa/e2e/tests/chat-stress-flows.spec.ts`).

### Full run result

Vitest: **225/225 passed** (23/23 files). Playwright e2e: **9/11 passed**,
2 failed (`FS-02`, `FS-06` — real product findings above, not test bugs).
Report: `qa/reports/latest.html` (dated copy `qa/reports/2026-09-16-1630.html`).

### Self-check (per the QA process's step 9)

- **Every flow named in the flow-analysis doc — does each have a test that
  walks it end to end through the real UI?** Flows 1-5, 9-12 yes (`FJ-01`,
  `DJ-01`, `FS-01..FS-07`). Flows 6-8 (edit an expense, delete an expense
  with several matches, reset categories) — **no**, only API-level coverage
  (`CC-04..CC-11`) exists; no E2E walk through the real UI + real AI. Named
  plainly as an accepted gap, not silently skipped — see
  `qa/flow-analysis-2026-09-16.md`'s flow table. Reason: each needs the AI to
  correctly extract `searchFilters` from free text, which is a second axis
  of non-determinism on top of the intent/draft parsing already exercised;
  time-boxed out of this pass rather than rushed.
- **Does each flow test assert stored data field by field, not just that the
  request succeeded?** Yes for all of `FS-01..FS-07` and the flagship
  (`FJ-01` checks `amount` only — see below) — `FS-01`/`FS-03` check amount,
  category-id-is-real, and date; `FS-02` checks amount changed and count
  stayed at one. `FJ-01` itself was **not** widened this pass (left as the
  single-field-check original) — it remains a real, if smaller, sample of
  Finding A's gap; the new `FS-*` tests carry the field-level rigor instead
  of retrofitting the older test.
- **Does at least one path exercise the real producer of a payload rather
  than a hand-written one?** Yes — `FJ-01` (pre-existing) and every `FS-*`
  test drive the real `backend/ai/` call end to end; `CR-*` deliberately
  stays hand-written/deterministic since `/chat/confirm` never calls the AI
  (same reasoning as `CC-*`).
- **For every escaped bug read this run, was a test *class* added to the
  roadmap, and were already-covered areas re-checked against it?** Yes — see
  the lessons table and the CS-05/06/07 + AI-01 re-derivation above.
- **Is there any flow where the only coverage is a single happy-path walk?**
  Yes, plainly: flows 6, 7, and 8 (edit/delete an expense, reset categories)
  have only the API-level happy/negative paths from `CC-04..CC-11` — no
  multi-turn or adversarial E2E variant exists for any of the three. That is
  a sample, not coverage, and is named here rather than left implicit.

### Verified matching the two intentionally-open items (not failures)

- **Bug 6 (typing "yes" instead of clicking Confirm)** — `FS-07` confirms
  current behaviour: no expense is silently saved by typing "yes". Passing,
  documents the open state per the task's explicit instruction.
- **Bug 10, second half (create-category + save-under-it needs two
  confirmations)** — not given a dedicated test this pass (would need a
  multi-step real-AI flow with an uncertain number of turns depending on
  model wording); `FS-04` incidentally confirms the *first* half still holds
  (a nonexistent category is never silently saved as an expense). The second
  half remains unverified by automation, named here as a gap rather than
  assumed.

### Out of scope this pass (and why)

- E2E walks for edit-expense, delete-expense (incl. "several matches, pick
  one"), and reset-categories through the real UI + real AI — accepted gap,
  see self-check above.
- Widening `FJ-01` itself to field-level assertions — left as-is; the new
  `FS-*` tests carry the rigor forward instead of retrofitting every
  existing E2E test in the same pass.

---

# Designed (sixth run, 2026-09-16) — user-first redesign, both environments

**Not yet automated.** `qa-lead` designed these; Adam approves; `qa-tester`
implements. Nothing below has test code.

This run started at the keyboard, not in the files: a real signup, real chat
messages against the real model, the real dashboard, and direct database reads —
with the specs and the bug records closed. Field notes:
`qa/field-notes-2026-09-16-exploratory.md`. User model, archetypes and flows:
`qa/flow-analysis-2026-09-16b.md`.

## New specs

| Spec | Cases | Environment |
|---|---|---|
| `qa/specs/flow-fresh-2026-09-16.md` | FR-01 … FR-27, XS-01 … XS-06 | fresh |
| `qa/specs/flow-lived-in-2026-09-16.md` | LV-01 … LV-22 | lived-in |
| `qa/specs/env-lived-in.md` | the environment itself | — |

`FR-` is a new prefix; `FS-` was already taken by `e2e-chat-stress-flows.md`.

## The classes this run adds, applied backwards

Each is a class, not a case. They govern every future test and re-grade every
existing one.

| Class | What it says |
|---|---|
| **C1** | After any write, assert every field the user supplied **and** every field the system derived. Not that a row exists. Not a count. |
| **C2** | Assert the assistant's prose and its structured payload agree, and that the app refuses to act when they do not. |
| **C3** | On every non-confirm path, assert the absence of a write by count **and** by content. |
| **C4** | At least one case per flow originates its payload from the real AI, not a hand-written body. |
| **C5** | Assert the user can tell which of the four draft outcomes occurred — confirmed / cancelled / discarded / broken. |

C1 and C4 restate `Finding A` from `2026-09-16-manual-bugs-found.md`, which this
run derived independently before reading it. C2, C3 and C5 are new, and come from
the exploratory session.

## What these classes demote to samples

Not failures — useful tests that were being counted as more than they are.

| Existing | Now | Why |
|---|---|---|
| `CC-02` and every `06-chat-confirm.test.ts` case | sample of the endpoint contract | Hand-built payload, asserts `amount` + row exists. C1 and C4 both unmet. |
| `08-expenses-categories.test.ts` category checks | sample | Asserts a count of 17. Would pass with 17 rows of garbage names. |
| `DJ-01` and every total-only dashboard case | sample | The total can be right while the breakdown, the dates and the recent rows are all wrong. C1. |
| `FJ-01`, `chat-dashboard-journey.spec.ts` | sample | Deterministic, AI deliberately bypassed. C4 unmet — nothing verifies that what the AI produces is what the save path accepts. |
| `UJ-01` ("survive a reload") | **suspect, re-check** | It passes, yet a reload logs the user out by hand (FR-16/FR-17). Either it exercises a different build or it is a latent flake. |
| Every flow's single happy-path walk | sample | Already named in the fifth-run self-check; unchanged. |

## Blockers

| # | Blocker | Owner |
|---|---|---|
| B-A | **`last Tuesday` has no rule.** Resolved to 2026-09-08 when 2026-09-15 was also a Tuesday. `docs/specs/01-ai-chat.md` §6 fixes only the no-date default. FR-12 cannot assert until Adam decides. | Adam — spec |
| B-B | **Out-of-range dates have no rule.** Nothing says what happens to a date in 2099 or 1970. XS-06 blocked. | Adam — spec |
| B-C | **The testing-reference derivation markers are all stale.** `backend/bl,dal,models,routes` has moved since `62cb457`, `backend/ai` since `ece6439`, and `client/src` since `60c12e2` — the latter by ~1,500 lines including the entire dashboard, which has no area file at all. Per `.claude/rules/testing-reference.md` that folder is the main session's to update, not `qa-lead`'s, so it is reported rather than rewritten. | Adam / main session |

## Not covered this round, accepted

- **Performance beyond a smoke budget.** LV-15 records a render time and a
  screenshot; there is no performance budget in any spec to assert against.
- **Concurrency beyond two tabs.** FR-18 covers two. Nothing covers N.
- **Accessibility.** No spec makes a claim, so there is nothing to test against.
  Worth a spec before it is worth a test.
- **The design canvas (`docs/designs/Expenses Redesign.dc.html`).** Not compared
  against the built client this run. It is the source of truth for structure and
  copy that specs do not pin down, and it deserves its own pass.

## Second pass, same day — the nine standard areas

Adam ruled that nine standard QA areas must all be covered, and that a missing
spec is not grounds to skip a check — it is grounds to propose a bar.

| Area | Now covered by |
|---|---|
| User experience | FR-41, FR-42, FR-43, FR-44 (plus FR-05, FR-07, FR-11) |
| UI | FR-38, FR-39, FR-40, LV-15 |
| Response time | FR-36, FR-37, LV-24 |
| Input diversity | LV-23 + the 180-sentence corpus, `env-lived-in.md` §2a |
| Edge values | FR-28, FR-29, FR-12, LV-09 |
| Interruption mid-flow | FR-32, FR-33, LV-27 |
| Log out / back in / carry on | FR-34, FR-35, LV-25 |
| Nonsense and injection | FR-31, XS-07, LV-26 |
| Missing info given later | FR-09 (amount), FR-30 (category) |

**Two proposed bars need Adam's confirmation** — they are written into the cases
and marked PROPOSED:

- **Response time:** screens usable in 2 s, chat reply in 10 s, visible feedback
  within 300 ms. `flow-fresh-2026-09-16.md` Group 9.
- **"Looks right":** seven rules covering three screen widths, four screen states,
  touch targets, and copy correctness. Group 10.

A third, **FR-43**, proposes that the app should reply in the language it was
written to. If Adam rejects that, the case is deleted rather than weakened.

**Input diversity is now a design decision, not a volume number.** 180 distinct
sentences are written once and checked in; the seeder parses them locally to build
the history; a named 40 are sent through the real model as LV-23, reported
sentence by sentence.

## Layer per case — added 2026-09-16

Every case in both new specs now carries a **Layer** field, and both specs open
with a binding "Layer discipline" section. This was missing: without it the
implementer picks the layer, and the cheapest reading of almost any case is an
API test — the exact failure that put `FJ-01` and the chat-dashboard journey in
the demoted column.

| Layer | Cases | |
|---|---:|---|
| Browser only (headed Chromium) | 56 | |
| Split — browser **plus** API, unit or a data sweep; both halves required | 21 | |
| API only | 8 | XS-01…XS-04, XS-06, FR-35, BD-02, BD-07 — going *around* the UI, or checking contracts and logs |
| **Total** | **85** | **77 touch a real headed browser** |

Revised the same day on Adam's instruction: everything that can honestly be driven
through the UI moved to the browser layer. FR-04 and the five sweeps LV-18…LV-22
became split cases rather than browser-only, because the dashboard renders
`slice(0, 10)` of the recent expenses — a browser pass sees ten rows of 180 and
**cannot** replace a sweep over the whole collection. Each of those five states
plainly what its browser half can and cannot see, so the cheap half is never
counted as the full check.

Browser tests run with `headless: false`, recorded here and in
`.agents/qa-project-context.md` → Conventions.

## Bug-derived classes — BD-01 to BD-07, added 2026-09-16

The eleven escaped bugs were read **last**, after the 78 cases existed, so they
extended the design instead of defining it. Seven new cases, every one aimed at a
part of the app the bug never touched:

| ID | Class | Where the same mistake still lives |
|---|---|---|
| BD-01 | Incomplete / unresolvable draft | The five intents nobody has ever sent a broken shape |
| BD-02 | Two components each internally consistent, disagreeing at the seam | Every AI↔server field that is a name on one side, an id on the other |
| BD-03 | A system-*derived* value wrong while the typed values are right | The category and message write paths (C1 only closed it for expenses) |
| BD-04 | The outcome of a write not recorded anywhere durable | The six intents beyond create, and every failure path |
| BD-05 | No conversation memory → now a 10-message memory **edge** | Turn 11 and beyond |
| BD-06 | Garbage inside a well-typed string field | The reply bubble, and stored labels on the dashboard forever after |
| BD-07 | A failure that cannot be reconstructed afterwards | Every error path; nothing in the suite tests observability at all |

**Four bugs produced no case**, because the 78 already cover their class: bug 11
(→ FR-38), bug 6 (→ FR-02/FR-03), bug 4 (→ FR-12 + rule C1), bug 1 (→ FR-05,
FR-29, XS-05). Recorded rather than padded.

**BD-07 is expected to fail** on one assertion: the AI-response half of the
logging gap is recorded as still open. That is deliberate.

---

# Round 2026-09-17b — the tutorial, the extraction, and thirteen unverified fixes

**Designed, not automated.** `qa-lead` stops here per
`.claude/rules/delegation.md`; Adam reviews, then `qa-tester` implements.

**State going in:** 225 V1 cases plus 67 designed V2 cases. Thirteen fixes sit
in the working tree, **uncommitted and unverified by any run**. A new public
page exists, and three components were extracted out of `HomePage` and
`DashboardPage` so it can reuse them.

**Design order followed:** exploratory session by hand → four questions →
archetypes → flow list sealed → **then** the bug reports and specs.
Field notes: `qa/field-notes-2026-09-17-exploratory.md`. Flows:
`qa/flow-analysis-2026-09-17.md`.

## New blockers

| # | Item | Why it blocks | Effort | Owner |
|---|---|---|---|---|
| B8 | **No server-side backstop for amount precision.** `expenseModel.amount` has `min: 0.01` and nothing else; `expenseService` applies no precision check. `12.345` is a valid Number above 0.01 and will be stored. The only defence is a sentence in `backend/ai/prompt.js`, and a prompt is fallible by construction. | `RG-04` cannot pass. Once an over-precise amount is stored, every total is computed from it while every screen prints a rounded version, so the dashboard's rows stop summing to its own total — and nothing crashes. | small | **Adam only** — `backend/models/expenseModel.js` or `backend/bl/expenseService.js`. Not written, not sketched. |
| B9 | **`backend/ai/` has no output-length cap and no repetition guard.** The 2026-09-17 run recorded a 207 KB response from a one-sentence parse. | `RG-30` fails. A wasted API call and a dead-ended user. | small | **Claude** — `backend/ai/`. Fixable without Adam writing code, but the ceiling (proposed: 8 KB) is his number. |
| B10 | `buildPending` is not exported from `client/src/store/chatSlice.ts` | `FR-05`'s unit half, carried over from the 2026-09-17 run's gap table. | trivial | **Claude** — `client/`. Listed because the earlier run filed it as a blocker without saying it is not an Adam-only one. It is an ordinary change. |

B4 (no committed `backend/.env.example`) remains open and Adam-only.

## Roadmap, risk desc / effort asc

| # | Target | Level | What it asserts | Risk | Effort | Depends on |
|---|---|---|---|---|---|---|
| 34 | `client/src/store/authSlice.ts` — `initialState.status` | browser | `RT-01`…`RT-04`: reloading or deep-linking `/dashboard` lands on `/dashboard`, and never passes through `/login` | 3 | 1 | — |
| 35 | `backend/error_handling.js` — 11000 branch | unit | `EH-12`…`EH-15`: the 409 field is derived from `err.keyValue`; three shapes; no `"undefined already exists."` | 3 | 1 | — |
| 36 | `backend/bl/userService.js` — rotation | api + browser | `RG-09`…`RG-11`: ten reloads keep the session; concurrent refreshes both succeed; the old token still dies after the grace window | 3 | 2 | reads `RACE_GRACE_MS` from source |
| 37 | `backend/routes/chatRoute.js`, `backend/bl/expenseService.js` | api | `RG-12`, `RG-13`: empty message → 400 not 500; no expense without a label, including whitespace-only | 3 | 1 | — |
| 38 | `backend/ai/prompt.js` + `schema.js` | unit | `AI-13`…`AI-17`: the sign and precision rules are present; the prompt and schema agree field by field | 3 | 1 | — |
| 39 | `backend/models/expenseModel.js` | api | `RG-02`, `RG-04`: negative and over-precise amounts never reach the database | 3 | 1 | **B8** for `RG-04` |
| 40 | `client/src/lib/dashboardFormat.ts`, `ChatScreen.tsx` | component | `SC-01`…`SC-03`, `RG-31`: one money formatter; the chat and the dashboard print the same amount identically | 3 | 1 | — |
| 41 | `backend/ai/prompt.js` — behaviour | browser, real model | `RG-01`, `RG-03`, `RG-05`, `RG-06`, `RG-08`: rates over repetitions, each paired with a no-write invariant | 3 | 3 | costs real Gemini calls |
| 42 | `client/src/store/chatSlice.ts` | component | `RG-07`: an unreadable draft always tells the user; never a silent drop | 3 | 2 | **B10** |
| 43 | `client/src/components/HowToUsePage.tsx` etc. | component + browser | `HT-01`…`HT-15`: public access, both navbar states, one animation at a time, no request, nothing typable | 2 | 2 | — |
| 44 | the three extracted components | component | `SC-04`…`SC-14`: the tutorial-only props, both callers, the dashboard unchanged | 2 | 2 | — |
| 45 | `client/src/index.css` | browser | `RG-20`, `RG-21`, `HT-16`, `HT-17`: 375px on every route in both auth states, element-level not document-level | 2 | 2 | — |
| 46 | `HomePage`, `chatSlice` — visible feedback | browser | `CX-01`…`CX-04`: your message appears within 150ms; a busy indicator throughout; the card shows the date | 2 | 2 | bars **proposed**, need Adam |
| 47 | `backend/logs/*` | integration | `RG-27`…`RG-29`: a failure can be reconstructed, and leaks nothing | 2 | 2 | — |
| 48 | `backend/ai/` output ceiling | unit | `RG-30` | 2 | 1 | **B9** |
| 49 | accessibility of the tutorial | component + browser | `HT-18`…`HT-21`, `SC-07`: reduced motion, no focusable control inside `aria-hidden`, keyboard order | 2 | 2 | `HT-18` needs a **spec decision** first |
| 50 | tutorial copy and content | browser | `HT-22`…`HT-24`, `HT-32`, `HT-33`, `CX-06`: the waiting state does not misinstruct; the printed sentences actually work | 2 | 2 | `SC-10` proposes the fix shape |
| 51 | `store` vs `description` | api + browser | `SD-01`…`SD-03`: a STORE column does not print a description; an edit finds either | 2 | 2 | — |
| 52 | A5 / A6 debt from the 2026-09-17 run | browser, lived-in | `RT-09` replaces the `LV-17` tautology; `RT-10` unblocks `LV-04`/`LV-05` by asserting the seed corpus first | 2 | 3 | fixture repair |
| 53 | `HT-25`, `HT-26` — timers | component, fake timers | the animation never jumps backwards on a parent re-render; timers and observers are torn down | 1 | 1 | — |
| 54 | `HT-07` — sequencer interruption | browser | replaying one lesson does not strand another mid-animation | 2 | 1 | derived from code, **not reproduced** |

## Not covered, accepted — each with a risk judgement, not a shrug

- **Visual-diff baselines.** No pixel baselines exist, so "nothing clipped, no
  layout collapse" stays partly unprovable. *Acceptable today because* `HT-16`,
  `RG-20` and `SC-15` assert element-level geometry at 375px, which catches the
  two layout failures that have actually occurred here; a baseline harness is a
  larger piece of work than this round and would land untrusted.
- **Bug 2 has no deterministic backstop.** Whether a correction reached the
  payload is answerable only from the model's output — both 18 and 22 are valid
  amounts, so no server-side invariant exists. *Acceptable today because*
  `RG-06` walks the real producer at 5 repetitions across 3 phrasings, which is
  the strongest claim the design supports. It must be re-run on every prompt
  change.
- **`docs/designs/` conformance beyond three pinned tokens.** *Acceptable today
  because* `SC-13` pins the three places the serif/gold tokens apply, which is
  where the `.dashboard-vars` change could regress the real dashboard.

## Missed — I did not design it, and it says so

Not the same list as the one above. These have no risk judgement because the
honest reason is that I ran out of design, not that I weighed it.

- **Reduced motion combined with a reload.** `HT-19` covers reduced motion plus
  Replay; the reload path is absent.
- **Scroll-driven election at 375px**, where every lesson is full-width and the
  "most in view" arithmetic differs from desktop. This is the case I would
  write next.
- **`DashboardTotals` at zero expenses** — the empty dashboard a real user sees
  on their first evening. No case in this round renders it.
- **Replaying a lesson at 375px**, and reading the tutorial on a phone with an
  expired session.
