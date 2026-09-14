# qa/ — standalone QA package for the Expenses backend

Independent of `client/` and `backend/` dependency trees. Its own `package.json`
and `node_modules`.

## Run it

```bash
npm install --prefix qa
npm test --prefix qa
```

`npm test` runs `qa/scripts/run.mjs`, which:

1. runs Vitest — `qa/harness/globalSetup.ts` spawns `node backend/index.js` with
   `MONGODB_URI` rewritten to end `/expenses_qa_test` and `PORT=3100`, waits for
   readiness, then all suites run;
2. on teardown, stops the server and **drops the `expenses_qa_test` database**;
3. builds `qa/reports/<YYYY-MM-DD-HHMM>.html` and `qa/reports/latest.html`
   (self-contained, opens by double-click), plus a raw JSON copy.

`backend/.env` is only **read** (never written, never committed). The test
database is a distinct name on the same Atlas cluster as dev; Adam's dev data
lives in Mongoose's default `test` DB and is never touched.

## Layout

| Path | What |
|---|---|
| `test-roadmap.md` | ordered plan: what to test, at which level, blockers |
| `specs/*.md` | test design — per-test purpose / method / expected (SDD) |
| `tests/unit/` | `userService`, `requireAuth`, `error_handling` — doubles, no DB |
| `tests/integration/` | `logger`, models, `connectDB`, start-up — real test DB / child processes |
| `tests/api/` | the four `/users/*` endpoints + cross-cutting — real HTTP, real test DB |
| `harness/` | server spawn, env parsing, test-DB client, Vitest global setup |
| `fixtures/` | `schemas.ts` (zod response contracts), `factories.ts` (unique users, cookie helpers) |
| `scripts/` | `run.mjs` (one-command run), `testcases.mjs` (inlined design cases), `build-report.mjs` |
| `reports/` | dated HTML + `latest.html` + raw JSON; dated files are never overwritten |

## Traceability

Every test title starts with its ID (`US-01`, `RF-05`, …). The same IDs index
`specs/*.md` and `scripts/testcases.mjs`. The HTML report inlines each test's full
design-time case next to its actual result.

## Known spec/code divergences (carried through, visible in the report)

| ID | Spec says | Code does |
|---|---|---|
| RA-06 | `requireAuth` verify-failure body `{ error: "Not authenticated." }` (06 §4) | `{ error: "Invalid or expired token!" }` |
| XC-11 | 404 body `{ error: "Not found." }` (07 §4) | `{ error: "Not Found" }` |
| XC-13 | `helmet()` is middleware #1 (07 §2) | `compression()` is #1, `helmet()` #2 |
| EH-05 | 409 body `"<field> already exists."` (06 §3.2) | `"That username or email is already taken."` |

RA-06 and XC-11 assert the spec and therefore **fail** until either the code or
the spec is changed. XC-13 and EH-05 pass on the behaviour that matters and are
recorded as notes.
