# Test roadmap — Expenses backend (auth surface)

_State: no automated backend tests existed. `backend/package.json` `test` is a stub.
The QA package at `qa/` is a standalone Vitest project. Client logic already
has Vitest + RTL coverage in `client/` and is not re-tested here._

Re-derived against the code on 2026-09-10. Ordering: risk desc, then effort asc.

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

## Out of scope (and why)

- **Client modules** (`authApi.ts`, `httpClient.ts`, `authSlice.ts`, `LoginPage`/`SignupPage`/`NavBar`/`ProtectedRoute`) — already covered by `client/`'s Vitest suite. Not duplicated.
- **`categoryModel.js`** — no route exercises it, and no built feature depends on it. Its two-level parent rule, protected-"Other" rule, and cascade-on-delete middleware are complex but dormant. Deferred until `/categories` or the sign-up default-set copy is built.
- **`Message` model** — not defined in `backend/models/` yet (spec 04 lists it; no file).
- **AI chat / dashboard / `/chat/*` / `/expenses/*`** — not built.
- **Global rate limiter exact ceiling (300/15 min)** — would need 300+ requests; disproportionate. We assert only that a global limiter is present and looser than the login one.
- **`socket.io`, `axios`, `jsonfile`, `csurf`, `winston-daily-rotate-file`** — in `backend/package.json` but unused by any built code. `csurf` is deprecated; spec 07 says no CSRF in v1. Noted, not tested.

## Not covered, accepted

- **HTTPS `secure: true` cookie path** — code hard-codes `secure: false` for local http (spec 05 §6.1 says `true` once on HTTPS). No HTTPS in v1; the `false` branch is what ships. Accepted.
- **TTL index actually deleting an expired row** — MongoDB's TTL reaper runs ~every 60 s; asserting real deletion would make the suite slow and flaky. We assert the index *definition* only (MD-* checks `expireAfterSeconds: 0` on `expiresAt`).
- **`exception.log` / `rejection.log` crash handlers** — would require crashing the process mid-suite. We assert the handlers are configured on the logger instance (LG-* inspects `logger.exceptions`/transports), not that a real uncaught throw lands there.
- **Concurrency / race on the duplicate-key 409** — we simulate the race by disabling the async validator path (posting a duplicate that the unique index catches), not by true parallel requests.
