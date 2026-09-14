# Test spec — `POST /users/refresh` (api)

**Under test:** the running server's `POST /users/refresh` (route local 401 handling + `userService.refresh` rotation).
**Governing spec:** `docs/specs/03-api-contract.md` §1; `docs/specs/05-user-layers.md` §6 `/refresh`, §8; `docs/specs/04-data-model.md` "RefreshToken"; `docs/specs/06-server-modules.md` §3.3 (no-cookie 401 not logged).
**Level:** api — real HTTP, real Mongo. Helper `signupAndGetCookie()` returns the `refreshToken` cookie string from a fresh signup. The test sends it back via the `Cookie` request header (Node `fetch` does not manage a cookie jar — do it by hand). A QA `mongoose` connection to `expenses_qa_test` counts `RefreshToken` rows.
**Automation:** `qa/tests/api/refresh.test.ts`.

---

### RF-01 — no cookie → 401 with the general error shape
- **Purpose:** the normal "nobody is logged in" case on start-up (spec `05` §6 step 1).
- **Method:** `POST /users/refresh` with **no** `Cookie` header.
- **Expected:** HTTP `401`. Body matches `GeneralError.strict()` (`{ error: string }`). No `Set-Cookie` clearing anything is required, but if present it must not set a real token.

### RF-02 — the no-cookie 401 is NOT written to `logs/error.log`
- **Purpose:** spec `06` §3.3 / `05` §8 — this 401 is answered in the route, not the central handler, and must not be logged as an error.
- **Method:** record the byte length of the spawned server's `backend/logs/error.log` (the harness points the server's cwd at `backend/`, so this is the real file). Send the RF-01 request. Wait 300 ms. Re-read the file length.
- **Expected:** `error.log` did not grow. (If the file is shared with other suites, assert instead that no new line mentioning `/users/refresh` or `401` was appended after the recorded offset.)

### RF-03 — a valid cookie → 200 with `{ user, accessToken }`
- **Method:** `signupAndGetCookie()`, then `POST /users/refresh` with `Cookie: refreshToken=<value>`.
- **Expected:** HTTP `200`. Body matches `AuthSuccess.strict()` — `user` is `{ id, username, email }`, plus `accessToken`. No `password` / hash / `refreshToken` string in the body.

### RF-04 — refresh issues a NEW refresh cookie (rotation)
- **Method:** from RF-03, read `set-cookie`.
- **Expected:** a `refreshToken` cookie is set, and its value differs from the cookie that was sent in. Same attributes (`HttpOnly`, `SameSite=Lax`, `Max-Age=604800`, `Path=/`).

### RF-05 — the previous refresh token stops working after one successful rotation
- **Purpose:** the core rotation property (spec `05` §4 refresh step 3–4, `04` "RefreshToken").
- **Method:** `signupAndGetCookie()` → cookie C1. `POST /refresh` with C1 → 200, yields C2. `POST /refresh` **again with C1**.
- **Expected:** the second call with C1 returns HTTP `401`, and its response clears the cookie (`set-cookie` for `refreshToken` with an expired/empty value). C2 still works (a `POST /refresh` with C2 returns 200).

### RF-06 — a tampered cookie → 401 and the cookie is cleared
- **Purpose:** spec `05` §6 `/refresh` step 5.
- **Method:** `signupAndGetCookie()`, mutate the last char of the JWT, `POST /refresh` with the mutated cookie.
- **Expected:** HTTP `401`, body `{ error: string }`. `set-cookie` clears `refreshToken`.

### RF-07 — the `RefreshToken` collection grows by net zero per rotation
- **Purpose:** rotation deletes the old row and inserts one new row (spec `04` "RefreshToken", `05` §4).
- **Method:** with a QA mongo connection: `signupAndGetCookie()` (count is now N, includes this user's 1 row). Record N. `POST /refresh` once. Wait 200 ms. Re-count → M.
- **Expected:** `M === N` (one deleted, one inserted). Also: exactly one row exists for this user after the rotation.

### RF-08 — refresh returns the correct user
- **Method:** sign up user U (known username/email), get its cookie, `POST /refresh`.
- **Expected:** `body.user.username === U.username` and `body.user.email === U.email` and `body.user.id` is U's id.

### RF-09 — an unknown-but-well-formed token → 401
- **Purpose:** a token never issued by this server (not in the collection) is rejected at step 1 of `userService.refresh` (spec `05` §4).
- **Method:** sign a syntactically valid JWT with `REFRESH_TOKEN_SECRET` for `{ userId: <random ObjectId> }` **without** saving a row, send it as the cookie.
- **Expected:** HTTP `401`, body `{ error: string }`, cookie cleared.
