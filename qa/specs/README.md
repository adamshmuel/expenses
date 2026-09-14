# Test specs — design before automation

Each file here is the **design-time** half of the QA work: for every planned test,
a stable ID, its purpose (the property of the system it proves), what is under
test, the method (setup + exact inputs + action), and the expected result.

The automation in `qa/tests/` is written **after** these and cites the IDs. The
HTML report inlines each test's full case from here.

| Spec file | Area | Level | Test IDs |
|---|---|---|---|
| `unit-userService.md` | `bl/userService.js` | unit | US-01 … US-18 |
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

**Governing specs:** `docs/specs/01-ai-chat.md`, `03-api-contract.md`, `04-data-model.md`,
`05-user-layers.md`, `06-server-modules.md`, `07-server-entry.md`.

## Known spec divergences these tests will surface

| ID | Governing clause | Spec says | Code does | Test outcome |
|---|---|---|---|---|
| RA-06 | 06 §4 step 3 | verify-failure body `{ error: "Not authenticated." }` | `{ error: "Invalid or expired token!" }` | **FAIL** (asserts spec) |
| XC-11 | 07 §4 | 404 body `{ error: "Not found." }` | `{ error: "Not Found" }` | **FAIL** (asserts spec wording) |
| XC-13 | 07 §2 | `helmet()` is middleware #1 | `compression()` is #1, `helmet()` #2 | PASS with a recorded design note (helmet still covers every response) |
| EH-05 | 06 §3.2 | 409 body `{ error: "<field> already exists." }` | `{ error: "That username or email is already taken." }` | PASS on shape + status; wording divergence recorded as a note |
