# QA project context — Expenses

The one file every QA skill reads first. Re-derived from the code on 2026-09-10.

## Product

- **Name:** Expenses — home budget web app. Adam's Node.js course final project.
- **Type:** API service (Express, MongoDB) + React SPA client. API-only server, no SSR, no static serving.
- **URLs:** dev only. Server `http://localhost:3000`, client `http://localhost:5173`. No staging/prod.
- **Critical journeys (what exists today):**
  1. Sign up — `POST /users/signup` creates a user, hashes the password, returns `{ user, accessToken }` + sets the `refreshToken` HttpOnly cookie.
  2. Log in — `POST /users/login` verifies credentials, returns the same shape + cookie; generic 401 on any wrong credential; strict rate limit (5 / 15 min / IP).
  3. Refresh — `POST /users/refresh` rotates the refresh cookie (old row deleted, new pair issued), returns `{ user, accessToken }`; silent 401 when no cookie.
  4. Log out — `POST /users/logout` deletes the refresh-token row, clears the cookie, returns 204; idempotent.
  5. Access-token guard — `requireAuth` middleware protects future `/chat/*` and `/expenses/*` routes (not yet mounted); verifies the JWT, sets `req.user = { id, username }`.
  6. Cross-cutting — password never leaves the server; refresh token only in the cookie; one central error handler with two response shapes; log separation (5xx → `error.log`, deliberate 4xx not); helmet + CORS on every response.
- **Not built:** AI chat, dashboard, `/chat/*`, `/expenses/*`, `/categories`, `Message` model wiring.

## Tech Stack

- **Server:** Node.js 26, Express 5.2, CommonJS. `backend/` (Adam's, read-only for QA).
- **DB:** MongoDB Atlas via Mongoose 9.9. `MONGODB_URI` in `backend/.env` has **no database name in the path**, so the running server uses Mongoose's default DB (`test`). QA spawns the server with an overridden URI ending `/expenses_qa_test`.
- **Auth:** `jsonwebtoken` 9 (access 15 min / `JWT_SECRET`, refresh 7 d / `REFRESH_TOKEN_SECRET`), `bcrypt` 6 (10 rounds), HttpOnly cookie via `cookie-parser`.
- **Middleware:** `compression`, `helmet` 8, `cors` 2.8, `express-validator` 7, `express-rate-limit` 8, `morgan` → Winston 3.
- **Client:** React 19 + TypeScript + Vite, Redux Toolkit. `client/` (Claude's). Already has Vitest + RTL coverage.

## Test Stack

### Unit / API / Integration (this package: `qa/`)
- **Framework:** Vitest 3.x — standalone package at `qa/`, its own `package.json` and `node_modules`. Chosen to match the client's runner and the course's Vitest usage.
- **HTTP assertions:** native `fetch` against the spawned server (no supertest — the server does not export `app`, see Blockers).
- **Schema-as-contract:** `zod` 3.x — response shapes from specs 03/05 encoded once in `qa/fixtures/schemas.ts`, imported by every API test.
- **DB assertions & teardown:** `mongoose` 9 (a dedicated client in the QA package, not the server's).
- **Config:** `qa/vitest.config.ts`. **Test dir:** `qa/tests/` (`unit/`, `api/`, `integration/`).
- **Report:** custom JSON reporter → `qa/reports/YYYY-MM-DD-HHMM.json`, then `qa/scripts/build-report.mjs` renders a self-contained HTML to `qa/reports/<dated>.html` and `qa/reports/latest.html`.

### Client E2E
- **Framework:** None. No Playwright suite. Not warranted yet — no full-stack UI flow is built (chat/dashboard absent). Noted as a future item, not a gap for this round.

### Client unit/component
- **Framework:** Vitest + React Testing Library, in `client/` (pre-existing). QA does not duplicate; gaps noted in the roadmap.

## CI/CD

- **Platform:** none wired. `.github/` is git-ignored. No pipeline runs tests.
- **Deploy gate:** none. `npm test` in `backend/` is a stub (`exit 1`).
- QA suite is run locally via `npm test` in `qa/` (spawns the server, runs Vitest, tears down, builds the HTML report).

## Environments

- **One:** local dev. Server + Atlas. No staging.
- **DB isolation for tests:** the QA harness spawns `node backend/index.js` with `MONGODB_URI` rewritten to end `/expenses_qa_test` and `PORT=3100` (kept off the dev `3000`), waits for readiness, runs the suite, then drops `expenses_qa_test` and kills the server. `backend/.env` is never edited or committed.
- **Parity:** N/A (single environment). The test DB is the same Atlas cluster, a different database name.

## Quality Goals

Early-stage project, 6-day build. Concrete targets for this round:

| Metric | Target |
|---|---|
| Governing-spec assertion coverage | Every concrete claim in specs 03, 04, 05, 06, 07 that maps to built code has ≥ 1 test, or a documented blocker. |
| Unit coverage (backend units under test: `userService`, `requireAuth`, `error_handling`) | ≥ 85% lines on those three files' logic, measured via `c8` against the spawned/required module. |
| Flake rate | 0 over 3 consecutive local runs. |
| Suite duration | < 90 s including server spawn + teardown. |
| Test → design traceability | 100% — every test file cites its test-spec IDs; every test-spec item names a test file. |

## Risk Areas

| Area | Risk level | Business impact | Notes |
|---|---|---|---|
| Auth token issuance & rotation (`userService`, `/users/refresh`) | **Critical** | A rotation bug logs users out randomly or lets a revoked token live. Hard to notice. | Rotation deletes the old row then issues a new pair; assert net-zero row growth, old token dies after one use, secrets differ, payloads exact. |
| Credential-leak surface (password / hash / refresh token in a body) | **Critical** | Leaking a hash or the refresh token in JSON is a real security hole. | Assert no response body on any endpoint ever contains `password`, a bcrypt prefix, or `refreshToken`. |
| Error-response contract (`errorHandler`, validators) | **Important** | The client only understands two shapes; a third shape shows users a generic error and breaks field mapping. | Assert every error body is exactly `{ error }` or `{ errors: [{ field, message }] }`, `field` matches the body key. |
| `requireAuth` boundary | **Important** | Guards all future user-data routes. A wrong-secret or expired token slipping through is catastrophic; rarely changes. | No header / malformed / expired / tampered / wrong-secret → 401, `next` not called, no DB call; valid → `req.user` is exactly `{ id, username }`. |
| Log separation | **Monitor** | 5xx noise vs. real problems; the no-cookie `/refresh` 401 must not spam `error.log`. | Assert an `error` line hits `error.log` + `app.log`; a `warn` line hits `app.log` only; `{ area: "ai" }` line hits `ai.log`. |
| Rate limiting | **Monitor** | Login brute-force protection; global ceiling. | Strict: 429 after 5 login attempts / IP. Global: 300 / 15 min. Hard to test the global one without 300 requests — scope carefully. |
| Model validation (`User`, `RefreshToken`, `Expense`) | **Important** | Schema is the last line of defence behind the validators. | Field rules, unique indexes, TTL index on `expiresAt`, `Expense.amount` min 0.01, compound indexes. |
| Start-up safety (`connectDB` exit-on-failure) | **Monitor** | A server with no DB serving 500s is worse than a dead one. | Child-process test: bad URI → non-zero exit + `error` log. |

## Team

- **Solo.** Adam (student) writes `backend/`. Claude writes `client/` + `backend/ai/`. QA is this agent.
- **Dev:QA ratio:** solo / effectively infinite. QA owns strategy + all automated coverage under `qa/`; Adam owns the server code and acts on reported blockers.
- **Methodology:** spec-driven (`docs/specs/` → approve → plan → code). QA is SDD too: test spec before test code.
- **QA engages:** after a feature is built and manually verified (this run), against the frozen specs.

## Conventions

- **Test file naming:** `<area>.<subject>.test.ts` under `qa/tests/{unit,api,integration}/`. One file per test-spec area.
- **Traceability:** every `describe`/`it` title starts with its test ID (e.g. `US-01`). The test spec lists the same IDs. `qa/specs/` holds design; `qa/tests/` holds code.
- **Browser tests run headed.** Playwright `headless: false`, real Chromium. Adam
  asked for this explicitly so he can watch the suite work. Never silently switch a
  browser case to headless or to an API-level equivalent — see the "Layer
  discipline" section in `qa/specs/flow-fresh-2026-09-16.md`.
- **Selectors:** N/A (no browser tests this round). If Playwright is added later: `getByRole` first, `data-testid` only where no role fits (per `.claude/agents/builder.md`).
- **Test data:** a factory in `qa/fixtures/factories.ts` builds unique users (`faker`-style suffix from a seeded counter). Each API/integration test creates its own user; the harness drops the whole `expenses_qa_test` DB on teardown. Unit tests use in-memory doubles for the repository, `bcrypt`, and `jwt` — no DB.
- **Branching:** `main` only. QA never commits unless asked.
- **Backend boundary:** QA reads and executes `backend/` but writes nothing there (`.claude/hooks/protect-backend.py` enforces). Needed server changes are reported blockers.
