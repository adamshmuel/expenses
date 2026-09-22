# Test spec — `POST /users/signup` (api)

**Under test:** the running server's `POST /users/signup` (route → service → repository → `User` model), spawned by `qa/harness/server.ts` against `expenses_qa_test` on `PORT 3100`.
**Governing spec:** `docs/specs/03-api-contract.md` §0 and §1; `docs/specs/05-user-layers.md` §6, §7, §8, §10 decision 4.
**Level:** api — real HTTP via `fetch`, real Mongo (test DB). Each test builds a unique user via `qa/fixtures/factories.ts` (`makeUser()` → `{ username: "qa_"+n, email: "qa_"+n+"@test.io", password: "password123" }`). The harness drops the DB at the end; individual tests also delete the users they create where it matters for isolation.
**Response schema:** `AuthSuccess` in `qa/fixtures/schemas.ts` — `{ user: { id: string, username: string, email: string }, accessToken: string }`, `.strict()` (no extra keys).
**Automation:** `qa/tests/api/signup.test.ts`.

---

### SU-01 — valid signup returns 201
- **Method:** `POST /users/signup` with a fresh `makeUser()` body.
- **Expected:** HTTP `201`.

### SU-02 — the success body matches `AuthSuccess` exactly (no extra keys)
- **Method:** parse the SU-01 response JSON, validate against `AuthSuccess.strict()`.
- **Expected:** validation passes. Top-level keys are exactly `user`, `accessToken`. `user` keys are exactly `id`, `username`, `email`.

### SU-03 — the body contains no `password` and no bcrypt hash
- **Purpose:** password never leaves the server (spec `03` §1 "never return the `password` field"; `05` §5).
- **Method:** stringify the whole response body; search for `password`, `$2a$`, `$2b$`, `$2y$`.
- **Expected:** none present.

### SU-04 — the body contains no `createdAt`
- **Purpose:** spec `05` §10 decision 4 — response body is `{ id, username, email }` only.
- **Method:** inspect `body.user`.
- **Expected:** no `createdAt` key.

### SU-05 — the body contains no `refreshToken`
- **Purpose:** the refresh token lives only in the cookie (spec `05` §5).
- **Method:** stringify the body; search for `refreshToken`.
- **Expected:** not present.

### SU-06 — `Set-Cookie` sets an HttpOnly `refreshToken` with the right attributes
- **Purpose:** spec `05` §6.1 cookie options; reference doc HTTP-surface row.
- **Method:** read the `set-cookie` response header from SU-01.
- **Expected:** one cookie named `refreshToken`; attributes include `HttpOnly`, `SameSite=Lax`, `Max-Age=604800`, `Path=/`. It does **not** include `Secure` (local http, `secure:false`).

### SU-07 — `user.id` is a 24-hex Mongo ObjectId string and `user.username`/`user.email` echo the request
- **Method:** from SU-01, check `body.user`.
- **Expected:** `id` matches `/^[a-f0-9]{24}$/`. `username` equals the request username. `email` equals the request email (lowercased).

### SU-08 — username shorter than 3 → 400 with the `errors` shape, `field: "username"`
- **Purpose:** spec `05` §7 (username 3–20), `03` §0 error shape.
- **Method:** `POST /users/signup` with `username: "ab"`, valid email, valid password.
- **Expected:** HTTP `400`. Body matches `{ errors: [{ field, message }, …] }` (schema `ValidationError`). At least one entry has `field === "username"`. No `error` key. No `user`/`accessToken`.

### SU-09 — invalid email → 400, `field: "email"`
- **Method:** `POST` with valid username, `email: "nope"`, valid password.
- **Expected:** HTTP `400`; an entry with `field === "email"`.

### SU-10 — password shorter than 8 → 400, `field: "password"`
- **Method:** `POST` with valid username/email, `password: "short"`.
- **Expected:** HTTP `400`; an entry with `field === "password"`.

### SU-11 — every `field` in a multi-error response matches a request body key exactly
- **Purpose:** spec `03` §0 — `field` must be `username` / `email` / `password` so the client maps it to the right input.
- **Method:** `POST` with `username: "ab"`, `email: "nope"`, `password: "x"` (all three invalid).
- **Expected:** HTTP `400`; the set of `field` values is a subset of `{ "username", "email", "password" }`; no other field names appear.

### SU-12 — a duplicate username → 400 (via the async validator) OR 409 (if it races the unique index)
- **Purpose:** spec `05` §8 — normal path is the async validator (400 on the field); a race that slips past becomes a 409 in the central handler (`err.code === 11000`).
- **Method:** signup a user, then `POST /users/signup` again with the **same username** (fresh email).
- **Expected:** HTTP is `400` with an `errors[]` entry `field === "username"` **or** HTTP `409` with a `{ error: <string> }` body. In both cases: no `password` in the body, and the response is one of the two agreed shapes. (With the async validator present, `400` is the expected outcome; `409` is accepted as spec-compliant.)

---

## Added 2026-09-17 — FR-39, the signup wording

### SU-13 — the username-length message matches spec 03
- **Purpose:** FR-39. The message was `"User name must between 3 and 20
  characters"` — a missing verb, and a field name (`User name`) that does not
  match its own input label or the `field` key the client maps on.
- **Under test:** `backend/routes/userRoute.js`'s `signupValidators`.
- **Method:** `POST /users/signup` with `username: "ab"` and an otherwise
  valid body. Then repeat with a 21-character username.
- **Expected:** 400, `{ errors: [...] }`, an entry with `field === "username"`
  and `message === "Username must be 3–20 characters."` in both.
- **Environment:** fresh.
- **Fails if reverted:** yes.
- **⚠ Implementer, read this.** The message contains an **en dash** (`–`,
  U+2013) between 3 and 20, not a hyphen (`-`). A test that retypes it by hand
  will fail for a reason that has nothing to do with the product. Assert
  against the string as written in `docs/specs/03-api-contract.md`; if the spec
  does not carry it verbatim, that is itself worth reporting, and the fallback
  is to read it from `backend/routes/userRoute.js` rather than to invent it.

### SU-14 — SU-11 still holds after the wording change
- **Purpose:** the neighbour check. FR-39 changed a `withMessage` on the
  username validator; SU-11 asserts every `field` key in a multi-error response
  matches a request body key.
- **Method:** re-run SU-11 unchanged.
- **Expected:** unchanged — the set of `field` values is a subset of
  `{ username, email, password }`. The fix touched the message, not the field
  key, and this is what proves it.
