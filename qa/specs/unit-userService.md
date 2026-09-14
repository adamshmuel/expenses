# Test spec — `bl/userService.js` (unit)

**Under test:** `backend/bl/userService.js` — `signup`, `login`, `refresh`, `logout`, and the private `issueTokenPair` exercised through the four exports.
**Governing spec:** `docs/specs/05-user-layers.md` §4 and §10 decision 1.
**Level:** unit. `userRepository`, `bcrypt`, and `jsonwebtoken` are replaced with test doubles (Vitest `vi.mock`). No database, no real crypto except where noted (`jwt` real for payload assertions — see method). Env vars `JWT_SECRET` / `REFRESH_TOKEN_SECRET` set by the test.
**Automation:** `qa/tests/unit/userService.test.ts`.

Doubles:
- `userRepository` — full mock; each function is `vi.fn()` returning a resolved value the test controls.
- `bcrypt` — `hash` is a spy returning `"HASHED::"+input`; `compare` returns a value the test controls.
- `jsonwebtoken` — **real** for US-01..US-04 (so payloads can be decoded); stubbed only where a `verify` throw must be simulated (US-11).

---

### US-01 — access token payload is exactly `{ id, username }`
- **Purpose:** proves the access token carries only what `requireAuth` reads (`req.user = { id, username }`), no more.
- **Method:** mock `userRepository.createUser` to resolve a fake user `{ _id: "u1", username: "amir", email: "a@x.io" }`. `bcrypt.hash` → `"HASHED::pw"`. Real `jwt`. Call `signup({ username:"amir", email:"a@x.io", password:"pw123456" })`. `jwt.decode` the returned `accessToken`.
- **Expected:** decoded payload keys are exactly `id`, `username`, `iat`, `exp`. `id === "u1"`, `username === "amir"`. No `email`, no `password`.

### US-02 — refresh token payload is exactly `{ userId }`
- **Purpose:** the refresh token is minimal and does not carry the username.
- **Method:** as US-01, `jwt.decode` the returned `refreshToken`.
- **Expected:** payload keys are exactly `userId`, `iat`, `exp`. `userId === "u1"`.

### US-03 — the two tokens are signed with different secrets
- **Purpose:** access and refresh secrets are separate (spec §10 decision 1) — a leaked access secret must not verify a refresh token.
- **Method:** set `JWT_SECRET="access-secret"`, `REFRESH_TOKEN_SECRET="refresh-secret"`. Run `signup`. Verify `accessToken` with `access-secret` (must pass) and with `refresh-secret` (must throw). Verify `refreshToken` with `refresh-secret` (pass) and `access-secret` (throw).
- **Expected:** each token verifies only under its own secret.

### US-04 — access token expires in ~15 min, refresh in ~7 days
- **Purpose:** token lifetimes match spec §10 decision 1.
- **Method:** run `signup`, decode both tokens, compute `exp - iat`.
- **Expected:** access `exp - iat` is `900` (± 2 s). refresh `exp - iat` is `604800` (± 2 s).

### US-05 — the refresh row is saved with `expiresAt` ≈ now + 7 days
- **Purpose:** the TTL index has a correct date to work from.
- **Method:** freeze time with `vi.useFakeTimers()` at a fixed instant. Run `signup`. Inspect the argument passed to `userRepository.saveRefreshToken`.
- **Expected:** called once with `{ token: <the refreshToken>, user: "u1", expiresAt: <Date> }` where `expiresAt.getTime() === Date.now() + 7*24*60*60*1000` exactly.

### US-06 — `signup` hashes the password before `createUser`
- **Purpose:** the repository never receives a plain password (spec §4 signup step 1–2).
- **Method:** `bcrypt.hash` spy → `"HASHED::pw"`. Run `signup({ username, email, password:"plaintextpw" })`. Inspect `bcrypt.hash` and `userRepository.createUser` calls.
- **Expected:** `bcrypt.hash` called once with `("plaintextpw", 10)`. `createUser` called once with an object whose `password === "HASHED::pw"` (not `"plaintextpw"`).

### US-07 — `signup` return shape
- **Purpose:** callers (the route) get `{ user, accessToken, refreshToken }`.
- **Method:** run `signup`, inspect the resolved value.
- **Expected:** keys exactly `user`, `accessToken`, `refreshToken`. `user` is the object `createUser` resolved. Both tokens are non-empty strings.

### US-08 — `signup` propagates a repository duplicate-key throw unchanged
- **Purpose:** the service does not swallow or remap `E11000` — the central handler does that (spec §4, §8, §10 decision 3).
- **Method:** `userRepository.createUser` rejects with `Object.assign(new Error("E11000 dup key"), { code: 11000 })`. Run `signup`.
- **Expected:** `signup` rejects with the same error object; `.code === 11000` is intact; `issueTokenPair` / `saveRefreshToken` were never called.

### US-09 — `login` with correct credentials returns the token pair
- **Purpose:** happy-path login (spec §4 login).
- **Method:** `findUserByUsername` → `{ _id:"u1", username:"amir", email:"a@x.io", password:"HASHED" }`. `bcrypt.compare` → `true`. Call `login("amir", "rightpw")`.
- **Expected:** resolves `{ user, accessToken, refreshToken }`; `user._id === "u1"`; `bcrypt.compare` called with `("rightpw", "HASHED")`.

### US-10 — unknown user and wrong password throw the **same** 401
- **Purpose:** the response must not reveal which was wrong (spec §4 login step 2, §8).
- **Method:** case A — `findUserByUsername` → `null`; call `login("ghost","x")`. case B — `findUserByUsername` → a user, `bcrypt.compare` → `false`; call `login("amir","wrong")`.
- **Expected:** both reject with an `Error` where `.status === 401` and `.message === "Username or password is incorrect."` — byte-identical. In case A, `bcrypt.compare` is **not** called (short-circuit on `user &&`). In neither case is a token issued.

### US-11 — `refresh` happy path rotates: old row deleted, new pair issued, same user
- **Purpose:** rotation (spec §4 refresh steps 1–6).
- **Method:** `findRefreshToken` → a stored row (truthy). Real `jwt`: pre-sign a valid refresh token for `{ userId: "u1" }` with `REFRESH_TOKEN_SECRET` and pass it in. `findUserById` → `{ _id:"u1", username:"amir", email:"a@x.io" }`. `deleteRefreshToken` → resolves. Call `refresh(oldToken)`.
- **Expected:** resolves `{ user, accessToken, refreshToken }`. `deleteRefreshToken` called once with `oldToken`. `saveRefreshToken` called once (new row) with a **different** token string. `user._id === "u1"`. Order: `findRefreshToken` → `jwt.verify` → `findUserById` → `deleteRefreshToken` → `saveRefreshToken`.

### US-12 — `refresh` with a token not in the collection → 401 "not recognized"
- **Purpose:** a rotated-out or pre-restart token is rejected before `jwt.verify` (spec §4 refresh step 1).
- **Method:** `findRefreshToken` → `null`. Call `refresh("whatever")`.
- **Expected:** rejects with `.status === 401`, `.message === "not recognized"`. `jwt.verify` / `findUserById` / `deleteRefreshToken` never called.

### US-13 — `refresh` propagates a `jwt.verify` failure
- **Purpose:** a tampered/expired token that is somehow in the collection still fails; the route turns the throw into a 401 (spec §4 refresh step 2).
- **Method:** `findRefreshToken` → truthy row. Pass a syntactically-invalid token string (`"not.a.jwt"`) so real `jwt.verify` throws `JsonWebTokenError`. Call `refresh("not.a.jwt")`.
- **Expected:** rejects with a `JsonWebTokenError` (or any error from `jwt.verify`). `deleteRefreshToken` / `saveRefreshToken` never called (rotation aborts before the delete).

### US-14 — the old refresh token cannot be used twice (rotation kills it)
- **Purpose:** end-to-end property of rotation at the unit level.
- **Method:** first call: `findRefreshToken` → truthy, valid token, `findUserById` → user, `deleteRefreshToken` → resolves. Run `refresh(old)`. Then simulate the row now being gone: `findRefreshToken.mockResolvedValue(null)`. Run `refresh(old)` again.
- **Expected:** first call resolves; second call rejects with `.status === 401` / `"not recognized"`.

### US-15 — `logout` deletes the given token
- **Purpose:** logout invalidates the refresh token (spec §4 logout).
- **Method:** `deleteRefreshToken` → resolves. Call `logout("tok123")`.
- **Expected:** `deleteRefreshToken` called once with `"tok123"`. Resolves to `undefined`.

### US-16 — `logout` with `undefined` is a safe no-op
- **Purpose:** logout is idempotent / safe when no cookie was sent (spec §4 logout, route §6).
- **Method:** `deleteRefreshToken` → resolves (mongoose `deleteOne` tolerates `undefined` filter value). Call `logout(undefined)`.
- **Expected:** does not throw; resolves. `deleteRefreshToken` called once with `undefined`.

### US-17 — `issueTokenPair` is not exported
- **Purpose:** the private helper stays private (spec §4 "Private helper", "not exported").
- **Method:** `require("backend/bl/userService")` and inspect its keys.
- **Expected:** exported keys are exactly `signup`, `login`, `refresh`, `logout`. No `issueTokenPair`.

### US-18 — `login` issues and stores a refresh row on success
- **Purpose:** login creates a `RefreshToken` row (spec 04 "RefreshToken": "Login creates one").
- **Method:** as US-09, inspect `userRepository.saveRefreshToken`.
- **Expected:** called once with `{ token: <refreshToken>, user: "u1", expiresAt: <Date ~7d out> }`.
