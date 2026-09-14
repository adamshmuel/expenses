# Test spec — `POST /users/login` (api)

**Under test:** the running server's `POST /users/login`.
**Governing spec:** `docs/specs/03-api-contract.md` §1; `docs/specs/05-user-layers.md` §6, §7, §8; strict rate limit `05` §6 / `03` §1.
**Level:** api — real HTTP, real Mongo (test DB). A `beforeAll` signs up one known user via `makeUser()` and keeps its credentials.
**Schema:** `AuthSuccess` (strict) for success; `GeneralError` = `{ error: string }.strict()`; `ValidationError` for 400.
**Automation:** `qa/tests/api/login.test.ts`.

**Rate-limit note:** the strict limiter is 5 attempts / 15 min / IP and is **process-global** (in-memory). Order matters — the 429 test (LI-08/09) must run **last** in this file, and this file must run in its own worker so it does not starve the other API files of login attempts. The harness runs API test files sequentially (`--pool=forks --poolOptions.forks.singleFork` or `fileParallelism:false`) for this reason.

---

### LI-01 — valid credentials return 200
- **Method:** `POST /users/login` with the known user's `{ username, password }`.
- **Expected:** HTTP `200`.

### LI-02 — the success body matches `AuthSuccess` exactly and equals signup's shape
- **Method:** validate the LI-01 body against `AuthSuccess.strict()`.
- **Expected:** passes; keys exactly `user` (`{ id, username, email }`) + `accessToken`.

### LI-03 — login sets a fresh HttpOnly `refreshToken` cookie
- **Method:** read `set-cookie` from LI-01.
- **Expected:** `refreshToken` cookie with `HttpOnly`, `SameSite=Lax`, `Max-Age=604800`, `Path=/`.

### LI-04 — no `password` / hash / `refreshToken` in the body
- **Method:** stringify the LI-01 body; search for `password`, `$2a$`/`$2b$`/`$2y$`, `refreshToken`.
- **Expected:** none present.

### LI-05 — missing `username` → 400 with the `errors` shape
- **Method:** `POST` with `{ password: "password123" }` only.
- **Expected:** HTTP `400`; body matches `ValidationError`; an entry with `field === "username"`; no `error` key.

### LI-06 — missing `password` → 400
- **Method:** `POST` with `{ username: "whoever" }` only.
- **Expected:** HTTP `400`; an entry with `field === "password"`.

### LI-07 — wrong password and unknown username produce the **identical** 401 body
- **Purpose:** the response must not reveal which was wrong (spec `03` §1, `05` §4/§8).
- **Method:** case A — `POST` with the known username + `password: "definitely-wrong"`. case B — `POST` with `username: "no-such-user-xyz"` + any password. Compare status and body.
- **Expected:** both HTTP `401`. Both bodies are exactly `{ "error": "Username or password is incorrect." }` — deep-equal to each other. Neither sets a `refreshToken` cookie.

### LI-08 — the login route is rate-limited: the 6th attempt in the window returns 429
- **Purpose:** spec `03` §1 "Rate-limit this route more strictly"; `05` §6 (5 / 15 min).
- **Method:** from a clean limiter state (this is the first login-heavy block in the file — the harness restarts the server before this file, see note), send 5 failing `POST /users/login` (wrong password), then a 6th.
- **Expected:** attempts 1–5 return `401`. Attempt 6 returns `429` with a `{ error: <string> }` body (the message is `"Too many login attempts, try again later."`).

### LI-09 — a 429 from the login limiter uses the general error shape
- **Method:** from the LI-08 6th response, validate the body against `GeneralError.strict()`.
- **Expected:** passes — exactly one key `error`, a string. No `errors` array.
