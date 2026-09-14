# Server testable surface — reference

Not a spec. A living inventory of **what exists in `backend/` right now and can
be tested**, so the `qa` agent has a starting map instead of guessing. This file
covers the server only — see
[`docs/reference/testing-reference/`](../testing-reference) for the client
counterpart and any other area added later.

Scanned 2026-09-10, moved into `docs/reference/testing-reference/` on
2026-09-11. Re-derived and updated by the `qa` agent on 2026-09-10 during the
first full QA run (see `qa/reports/latest.html`, `qa/test-roadmap.md`).
Divergences and the F-1 finding surfaced by that run are called out inline
below.

The `qa` agent reads every file in `docs/reference/testing-reference/` **on
every run, in full** — that is cheap, it's an inventory, not source code.
Whether it also **re-derives** this file (re-opening the actual `backend/`
source and re-checking every row) is gated by the Derivation state below, so an
unrelated change elsewhere doesn't cost a full re-scan of the server. If the
server grows a distinct new area (e.g. `backend/ai/`), that becomes its **own**
dated file in this folder rather than a new section bolted onto this one — see
the folder's `README.md`.

## Derivation state

| Covers | Last derived against | Notes |
|---|---|---|
| `backend/dal/`, `backend/bl/`, `backend/middleware/`, `backend/error_handling.js`, `backend/.config/`, `backend/models/`, `backend/index.js`, `backend/routes/` | commit `e48ce5b` | Full first derivation, 2026-09-10 QA run. |

Before re-deriving, diff this commit against the current tree for the covered
paths (`git diff --stat e48ce5b -- backend/dal backend/bl backend/middleware
backend/error_handling.js backend/.config backend/models backend/index.js
backend/routes`, excluding `backend/ai/`). No changes → this file is still
current: read it, don't re-derive it, update only the commit above if you
explicitly re-verified anyway. Changes → re-derive the affected rows and bump
the commit.

## How to read this

- Each row names something concrete that exists: an exported function, a mounted
  route, a spec assertion, a client module.
- The **"invites"** column is a prompt for the QA agent's judgement about the
  cheapest test level and the properties worth asserting — **not** a
  prescription. The agent decides the actual test design from the specs.
- "Governed by" points at the spec section that fixes the intended behaviour.
- Nothing here tells the agent *how many* tests to write or *which* cases. That
  comes from reading `docs/specs/` and thinking.

---

## Backend — units (`backend/`, excluding `ai/`)

Adam's code. **Read and execute only — never edit** (`.claude/hooks/protect-backend.py`
enforces this for every agent). All paths relative to repo root.

### `dal/userRepository.js` — data-access layer

| Export | Does | Invites |
|---|---|---|
| `createUser(obj)` | `new User(obj).save()`; password already hashed by the service | integration (needs Mongo): saves the doc; rejects on duplicate `username`/`email` (`E11000`); does **not** hash |
| `findUserByUsername(username)` | `User.findOne({ username })` | integration: returns the doc **with** `password`; returns `null` when absent |
| `findUserByEmail(email)` | `User.findOne({ email })` | integration: match / `null` |
| `findUserById(id)` | `User.findOne({ _id: id })` | integration: match / `null`; behaviour on a malformed id |
| `saveRefreshToken(obj)` | `new RefreshToken(obj).save()` | integration: persists `{ token, user, expiresAt }`; unique `token` |
| `findRefreshToken(token)` | `RefreshToken.findOne({ token })` | integration: match / `null` |
| `deleteRefreshToken(token)` | `RefreshToken.deleteOne({ token })` | integration: removes the row; no throw when nothing matches (idempotent) |

Governed by: `docs/specs/05-user-layers.md` §3.

### `bl/userService.js` — business logic

| Export | Does | Invites |
|---|---|---|
| `signup(obj)` | hash password (bcrypt, 10 rounds) → `createUser` → issue token pair → `{ user, accessToken, refreshToken }` | unit with the repository + bcrypt/jwt mocked: password is hashed before save; token pair issued; return shape. Negative: propagates a repository throw (duplicate) |
| `login(username, password)` | look up user → `bcrypt.compare` → on mismatch throw `Error` with `.status = 401` and the message `"Username or password is incorrect."` → else issue token pair | unit: correct creds return a pair; unknown user **and** wrong password both throw the **same** 401 message (no leak of which was wrong) |
| `refresh(oldRefreshToken)` | must be in the `RefreshToken` collection (else throw `.status = 401`, message `"not recognized"`) → `jwt.verify` with `REFRESH_TOKEN_SECRET` → look up user → **delete the old row** → issue a new pair → `{ user, accessToken, refreshToken }` | unit: happy path rotates (old row deleted, new pair issued); unknown token throws 401; a `jwt.verify` failure propagates; the old token cannot be used twice |
| `logout(refreshToken)` | `deleteRefreshToken`; returns nothing | unit: deletes the row; a `undefined`/absent token is a safe no-op |
| `issueTokenPair(user)` *(private, not exported)* | signs access `{ id, username }` / `JWT_SECRET` / 15m, refresh `{ userId }` / `REFRESH_TOKEN_SECRET` / 7d, saves the refresh row with `expiresAt` = now + 7d | exercised through the four exports: access payload is exactly `{ id, username }` (+ `iat`/`exp`), refresh payload is `{ userId }`, secrets differ, `expiresAt` ≈ 7 days out |

Governed by: `docs/specs/05-user-layers.md` §4; token lifetimes/secrets in §10 decision 1.

### `middleware/requireAuth.js`

| Export | Does | Invites |
|---|---|---|
| `requireAuth(req, res, next)` | reads `Authorization`; missing or not `Bearer ` → `401 { error: "Not authenticated." }` and **no** `next()`; else `jwt.verify(token, JWT_SECRET)`; success → `req.user = { id, username }` then `next()`; failure → `401 { error: "Invalid or expired token!" }` **— SPEC DIVERGENCE: spec 06 §4 step 3 requires this body to be `{ error: "Not authenticated." }` too (`requireAuth.js` line 41). Tracked as QA test RA-06 (failing).** | unit with a fake `req`/`res`/`next`: no header → 401, next not called; malformed header → 401; valid token → `req.user` set to `{ id, username }` only (no `iat`/`exp`), `next()` called once; expired/tampered/wrong-secret token → 401; no DB call happens |

Governed by: `docs/specs/06-server-modules.md` §4.

### `error_handling.js`

| Export | Does | Invites |
|---|---|---|
| `catchAsync(handler)` | wraps an async handler; a rejection is forwarded with `next(err)`; does **not** log, does **not** set status | unit: a rejecting handler calls `next` with the error; a resolving handler does not; nothing is logged here |
| `errorHandler(err, req, res, next)` | `err.code === 11000` → `409 { error: "That username or email is already taken." }` (logged `warn`); `err.status` set → that status + `{ error: err.message }` (logged `warn`); otherwise → `500 { error: "Something went wrong." }` (logged `error`), the real message only in the log | unit with fake `req`/`res` + the logger spied: each of the three branches → right status, right body, right log level; the 500 branch never puts `err.message` in the response body |

Governed by: `docs/specs/06-server-modules.md` §3; `docs/specs/03-api-contract.md` §0 (the two error shapes); `docs/specs/05-user-layers.md` §8 and §10 decision 3.

### `.config/logger.js`

| Export | Does | Invites |
|---|---|---|
| `logger` (Winston instance) | level `http`; transports: Console, `logs/app.log` (all), `logs/error.log` (`error` only), `logs/ai.log` (only lines tagged `area: "ai"`); exception + rejection handlers to their own files; shared line format `timestamp [LEVEL]: message {meta}` | unit / integration against a temp log dir: an `error` line reaches `error.log` **and** `app.log`; a `warn` line reaches `app.log` but **not** `error.log`; a line with `{ area: "ai" }` reaches `ai.log`; one without does **not**; empty meta prints no trailing `{}` |

Governed by: `docs/specs/06-server-modules.md` §1 and §6 decision 1; `docs/specs/01-ai-chat.md` §9.

### `.config/db.js`

| Export | Does | Invites |
|---|---|---|
| `connectDB()` | `mongoose.connect(process.env.MONGODB_URI)`; success → `logger.info`; failure → `logger.error` + `process.exit(1)` | integration: a good URI connects and logs info; a bad URI logs error and exits non-zero (test in a child process). Does not define models, does not seed |

Governed by: `docs/specs/06-server-modules.md` §2 and §6 decision 3.

### Mongoose models (`backend/models/`)

Schema-level validation is testable directly against a test DB.

| Model | Rules to assert | Governed by |
|---|---|---|
| `userModel.js` | `username` required, unique, 3–20, trimmed; `email` required, unique, lowercased, must pass `validator.isEmail`; `password` required; `createdAt` defaults to now; `toJSON` exposes the `id` virtual | `docs/specs/04-data-model.md` "User" |
| `refreshTokenModel.js` | `token` required + unique; `user` required ObjectId ref; `expiresAt` required; **TTL index** on `expiresAt` (`expireAfterSeconds: 0`); index on `user` | `docs/specs/04-data-model.md` "RefreshToken" |
| `expenseModel.js` | `amount` required, `> 0` (min `0.01`); `store`/`description` optional; `date` required, defaults now; `category` + `user` required refs; compound index `{ user, date }` | `docs/specs/04-data-model.md` "Expense" |
| `categoryModel.js` | *(read the file — not yet exercised by any route; two-level `parent` rule, compound unique `owner+parent+name`, `isProtected` on "Other", cascade-on-delete middleware)* | `docs/specs/04-data-model.md` "Category" |

---

## Backend — HTTP surface

Mounted in `backend/index.js` at `/users` (no `/api` prefix). Server is API-only.
Base URL in dev: `http://localhost:3000`.

| Method + path | Purpose | Governed by | Observable properties a test can assert |
|---|---|---|---|
| `POST /users/signup` | create account + log in | `03` §1, `05` §6 | `201`; body `{ user: { id, username, email }, accessToken }` — **no** `password`, **no** `createdAt`; `Set-Cookie: refreshToken=…; HttpOnly; SameSite=Lax; Max-Age=604800; Path=/`; `400` with `{ errors: [{ field, message }] }` on a bad body (username 3–20, valid email, password ≥ 8); `409 { error: … }` on a duplicate that races past the validator |
| `POST /users/login` | log in | `03` §1, `05` §6 | `200`; same body + cookie as signup; `400` `{ errors: [] }` when `username`/`password` missing; `401 { error: "Username or password is incorrect." }` for wrong username **or** wrong password (message identical for both); route is rate-limited **more strictly** than the rest — `429 { error: … }` after 5 attempts / 15 min per IP |
| `POST /users/refresh` | rotate refresh cookie → new access token | `03` §1, `05` §6 | no cookie → `401 { error: … }`, **not** logged as an error; valid cookie → `200` `{ user: { id, username, email }, accessToken }` + a **new** `Set-Cookie`; a used/rotated/tampered token → `401` + the cookie is cleared; the previous refresh token stops working after one successful rotation |
| `POST /users/logout` | invalidate refresh token | `03` §1, `05` §6 | `204`, no body; `Set-Cookie` clears `refreshToken`; safe (still `204`) when no cookie was sent; the token no longer works on `/refresh` afterwards |

Global (loose) rate limiter on **all** routes: `express-rate-limit`, 300 / 15 min
per IP, `429 { error: "Too many requests, please slow down." }`. Governed by
`docs/specs/07-server-entry.md` §2.

---

## Backend — cross-cutting behaviours

Span more than one module; best covered by API or integration tests against the
running server.

| Behaviour | What to assert | Governed by |
|---|---|---|
| Error response contract | every error body is **either** `{ error: "…" }` **or** `{ errors: [{ field, message }] }` — nothing else; `field` matches the request body key exactly | `03` §0 |
| Password never leaves the server | no response body, on any endpoint, ever contains `password` or the bcrypt hash | `01` §2, `03` §1, `05` §5 |
| Refresh token only in the cookie | `refreshToken` appears in `Set-Cookie`, never in a JSON body | `05` §5 |
| Security headers | `helmet` headers present on every response (incl. errors); `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, etc. | `07` §2 |
| CORS | responses carry `Access-Control-Allow-Origin: http://localhost:5173` (exact, not `*`) and `Access-Control-Allow-Credentials: true` | `03` §0, `07` §2 |
| Middleware order | `helmet` → `cors` → `express.json` → `cookie-parser` → request log → global rate-limit → routers → 404 → `errorHandler` last | `07` §2, §4 |
| 404 handling | an unmatched path → `404 { error: "Not Found" }` **— SPEC DIVERGENCE: spec 07 §4 #1 fixes this body as `{ error: "Not found." }` (`index.js` line 57). Tracked as QA test XC-11 (failing).** | `07` §4 |
| Middleware order — `compression` vs `helmet` | `index.js` mounts `compression()` first (line 30), then `helmet()` (line 31); spec 07 §2 lists `helmet()` as #1. `compression()` sends no response of its own, so every response is still helmeted. Design note, not a functional fault. Tracked as QA test XC-13 (passing). | `07` §2 |
| Refresh-token JWT is not unique per issue | `issueTokenPair` signs the refresh token as `jwt.sign({ userId }, REFRESH_TOKEN_SECRET, { expiresIn: '7d' })`. Two issues for the same user within the same wall-clock second produce a byte-identical token (payload + second-resolution `iat` are identical), which collides on the `RefreshToken.token` unique index; `errorHandler` maps the `E11000` to a **409**. Hits: signup-then-login, or a double-clicked login form. QA **finding F-1** (test LI-10, passing — confirms the behaviour). Suggested fix: add a random `jti` to the refresh payload. | `04` "RefreshToken", `05` §4 |
| `E11000` → 409 centrally | a duplicate-key error from any model with a `unique` index is turned into `409` by `errorHandler`, not by a service | `05` §10 decision 3, `06` §3 |
| Log separation | 5xx lands in `logs/error.log`; deliberate 4xx (401/409/validation) does **not**; the no-cookie 401 on `/refresh` is not logged as an error; AI-tagged lines land in `logs/ai.log` | `06` §3.3, §1 |
| Refresh-token rotation | one `/refresh` deletes the old row and issues a new one; the `RefreshToken` collection grows by 0 net per rotation; TTL index removes expired rows | `04` "RefreshToken", `05` §4 |
| Start-up sequence | `dotenv` first; `connectDB()` before/around `listen`; a failed DB connection exits the process rather than serving 500s | `07` §1 |

---

## Client — testable logic (`client/src/`)

Claude's code. React 19 + TypeScript + Vite, tested with **Vitest + React
Testing Library** (`npm test --prefix client` → `vitest run`). Query by
role/label/visible text, never CSS class or test id (`.claude/agents/builder.md`).

**These already have coverage** — `qa/` should not duplicate them, only note
gaps:

| Module | Existing test | Covers |
|---|---|---|
| `src/api/authApi.ts` | `authApi.test.ts` | each function hits the right `/users/*` path with the right body |
| `src/api/httpClient.ts` | `httpClient.refresh.test.ts`, `httpClient.baseUrl.test.ts` | `Authorization: Bearer` header; refresh-once-and-retry on 401; base URL from `VITE_API_URL` with a `localhost:3000` fallback |
| `src/store/authSlice.ts` | `authSlice.test.ts` | thunks (`login`, `register`, `restoreSession`, `logout`), reducers (`setAccessToken`, `clearErrors`, `sessionExpired`), `fieldErrors` mapping |
| `src/components/{LoginPage,SignupPage,NavBar,ProtectedRoute}.tsx` | `*.test.tsx` | form validation + submit, navbar logged-in/out states, protected-route redirect |

| Not yet covered | Note |
|---|---|
| `src/components/{HomePage,DashboardPage,LedgerSlip,FormField,PageNotFound}.tsx` | depend on `/chat` + `/expenses`, not built |
| end-to-end client ↔ real server | no browser E2E exists yet — candidate for `playwright-automation` once a UI flow is worth driving full-stack |

---

## Specs → checkable assertions

The map from `docs/specs/` to test intent. The `qa` agent reads the full spec;
this is the index.

| Spec | Status | Concrete claims to verify |
|---|---|---|
| `00-overview.md` | draft | scope only — no direct assertions |
| `01-ai-chat.md` | draft | auth routes `/signup` `/login` `/home`; logged-out → `/login`; access token in memory only (never `localStorage`); refresh once on 401; generic "username or password is incorrect"; login rate-limited. Chat flow = **not built** |
| `02-dashboard.md` | — | **not built** |
| `03-api-contract.md` | auth section agreed | base URL `http://localhost:3000`, origin `http://localhost:5173`; `cors({ origin, credentials: true })`; exactly two error shapes; the four `/users/*` request/response bodies + status tables; refresh returns user **and** token; logout `204` |
| `04-data-model.md` | agreed | `User` / `RefreshToken` / `Expense` / `Category` field rules and indexes (see models table above); refresh-token rotation on `/refresh`; TTL on `expiresAt` |
| `05-user-layers.md` | draft | the three-layer split (route→service→repository, each calls only the one below); every §3 repository function's return; every §4 service step incl. `issueTokenPair` payloads/lifetimes/secrets; §5 "service returns vs client sees"; §6 route handlers + cookie options (`httpOnly`, `secure:false`, `sameSite:'lax'`, `maxAge` 7d) + `publicUser` → `{ id, username, email }`; §7 where each validation lives; §8 error table end-to-end; §10 decisions (15m/7d, `findUserByEmail`, `E11000`→409 central, no `createdAt` in body) |
| `06-server-modules.md` | agreed | §1 logger transports incl. `ai.log` filter; §2 `connectDB()` shape + exit-on-failure; §3 `catchAsync` (forward only, no log) + `errorHandler` (409/`.status`/500, log levels, one place); §4 `requireAuth` contract; §5 `.env` variable list + `.env.example` committed; §6 decisions 1–4 |
| `07-server-entry.md` | draft | §1 start-up order; §2 middleware stack + order + rationale; CSRF = none (relies on `sameSite:lax`); no static serving; §3 only `/users` mounted, no `/api`; §4 404 then `errorHandler` last; §6 `PORT` + `CLIENT_ORIGIN` |

---

## Known blockers to testing

Facts, not tasks. The `qa` agent works around them as described and **reports**
anything that needs an Adam-only change.

| Blocker | Consequence | Work-around |
|---|---|---|
| `backend/index.js` calls `app.listen()` unconditionally and does not export `app` | in-process `supertest(app)` is not possible without an Adam change | **worked around in `qa/`**: `qa/harness/useServer.ts` spawns `node backend/index.js` as a child process per test file against `expenses_qa_test` on port 3100, hits it over HTTP with `fetch`, drops the DB and kills the server after |
| `backend/` is unwritable by Claude/agents (`protect-backend.py`) | the QA agent cannot add test hooks, fixtures, or an `app` export to the server | all test code lives under `qa/`; a needed server change is a reported blocker |
| Real MongoDB, shared `MONGODB_URI` in `backend/.env` | tests must not pollute Adam's dev data | **worked around**: `qa/harness/env.ts` rewrites the URI to end `/expenses_qa_test` (Adam's dev data is in Mongoose's default `test` DB — the URI has no path segment); `qa/harness/globalSetup.ts` drops `expenses_qa_test` before and after the run. `.env` is only read, never written or committed. Verified after the run: `expenses_qa_test` dropped, `test` untouched |
| No `.env.example` yet (`06` §5 / `07` §6 say it should exist) | a fresh checkout can't configure the server | **still a gap — ADAM ACTION NEEDED.** QA cannot create it (it would live under `backend/`). Reported in `qa/reports/latest.html` and `qa/test-roadmap.md` as blocker B4 |
| Access token TTL is 15 min; refresh 7 days | "expired token" cases can't wait for real expiry | **worked around**: the unit tests sign short-lived / already-expired tokens with the real secrets from `.env` (`{ expiresIn: -10 }`), and the rotation API tests `sleep(1100)` so a reissued refresh JWT gets a distinct `iat` |
| `jwt` timestamps are second-resolution | two token issues for the same payload+secret in the same second produce identical strings — see the F-1 divergence row above | QA tests that must observe rotation space their calls with `sleep(1100)`; the collision itself is captured as finding F-1 (test LI-10) |

---

## Not yet built (surface will grow here)

| Area | Where it will live | Spec |
|---|---|---|
| AI expense parsing | `backend/ai/` (Claude's) — plain functions, Gemini Flash Lite, never touches the DB | `01` §8 |
| Chat endpoints | `POST /chat/messages`, `GET /chat/messages?limit=` — behind `requireAuth` | `01` §6, `03` §3 |
| Expense endpoints | `POST /expenses`, `GET /expenses/summary?period=` — behind `requireAuth` | `02`, `03` §3 |
| Category management | `/categories` CRUD or a panel — deferred to v2 | `01` §10, `04` "Category" |
| Dashboard screen | `client/src/components/DashboardPage.tsx` + statistics | `02` |
| `index.js` `app` export | would unblock in-process API testing (currently worked around with a child-process spawn in `qa/`) | — |
| `.env.example` | a fresh checkout can configure the server; specs `06` §5 / `07` §6 require it. **Adam-only — lives under `backend/`.** | `06` §5, `07` §6 |

When any of these ship, add rows to the sections above; the `qa` agent will also
pick them up by re-scanning the code.

---

## Maintenance

The `qa` agent re-derives this document against the real code at the start of
every run and updates it if it has drifted. You can also edit it by hand when
you add a feature — either way, keep it a plain inventory: what exists, what it's
governed by, what it invites. No test counts, no pass/fail, no strategy prose.
