# Test spec — `POST /users/logout` (api)

**Under test:** the running server's `POST /users/logout`.
**Governing spec:** `docs/specs/03-api-contract.md` §1; `docs/specs/05-user-layers.md` §6 `/logout`.
**Level:** api — real HTTP, real Mongo. Helper `signupAndGetCookie()` as in the refresh spec.
**Automation:** `qa/tests/api/logout.test.ts`.

---

### LO-01 — logout returns 204 with no body
- **Method:** `signupAndGetCookie()`, then `POST /users/logout` with `Cookie: refreshToken=<value>`.
- **Expected:** HTTP `204`. The response body is empty (`await res.text()` is `""`).

### LO-02 — logout clears the `refreshToken` cookie
- **Method:** read `set-cookie` from LO-01.
- **Expected:** a `refreshToken` cookie directive that expires/empties it (value empty or `Expires` in the past / `Max-Age=0`).

### LO-03 — after logout, the old refresh token no longer works on `/refresh`
- **Purpose:** logout really invalidates the token (spec `05` §6 `/logout`, `04` "RefreshToken": "Logout deletes it").
- **Method:** `signupAndGetCookie()` → C1. `POST /logout` with C1. Then `POST /users/refresh` with C1.
- **Expected:** the `/refresh` call returns HTTP `401`.

### LO-04 — logout with no cookie is still 204 (idempotent / safe)
- **Purpose:** spec `05` §6 `/logout` — "Safe to call when nobody is logged in."
- **Method:** `POST /users/logout` with **no** `Cookie` header.
- **Expected:** HTTP `204`, empty body. No error.

### LO-05 — logout twice with the same cookie is safe
- **Purpose:** `userService.logout` is idempotent (spec `05` §4 logout).
- **Method:** `signupAndGetCookie()` → C1. `POST /logout` with C1, then `POST /logout` with C1 again.
- **Expected:** both calls return HTTP `204`. Neither throws a 500.
