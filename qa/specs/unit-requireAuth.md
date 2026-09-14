# Test spec — `middleware/requireAuth.js` (unit)

**Under test:** `backend/middleware/requireAuth.js` — the `requireAuth(req, res, next)` guard.
**Governing spec:** `docs/specs/06-server-modules.md` §4.
**Level:** unit. Fake `req` (`{ headers: {} }`), fake `res` (`{ status: vi.fn().mockReturnThis(), json: vi.fn() }`), fake `next` (`vi.fn()`). Real `jsonwebtoken`. `process.env.JWT_SECRET` set by the test to a known value.
**Automation:** `qa/tests/unit/requireAuth.test.ts`.

Helper: `makeReq(headers)`, `makeRes()`, sign a valid access token with `jwt.sign({ id:"u1", username:"amir" }, JWT_SECRET, { expiresIn:"15m" })`.

---

### RA-01 — no `Authorization` header → 401, `next` not called
- **Purpose:** an unauthenticated request never reaches the route (spec §4 step 2).
- **Method:** `req.headers` has no `authorization`. Call `requireAuth(req, res, next)`.
- **Expected:** `res.status(401)`, `res.json({ error: "Not authenticated." })`. `next` not called. `req.user` undefined.

### RA-02 — header present but not `Bearer ` → 401, `next` not called
- **Purpose:** malformed scheme is rejected (spec §4 step 2, "not in that form").
- **Method:** `authorization: "Token abc123"`. Call `requireAuth`.
- **Expected:** `res.status(401)`, `res.json({ error: "Not authenticated." })`. `next` not called.

### RA-03 — `Bearer` with no token → 401
- **Purpose:** `"Bearer "` with an empty token must not verify.
- **Method:** `authorization: "Bearer "`. Call `requireAuth`.
- **Expected:** 401 `{ error: "Invalid or expired token!" }` (empty string fails `startsWith("Bearer ")`? — `"Bearer "` does start with `"Bearer "`, so it proceeds to `jwt.verify("", secret)` which throws → falls to the catch). Expected body per spec §4 step 3: `{ error: "Invalid or expired token!" }`.

### RA-04 — valid token → `req.user` is exactly `{ id, username }`, `next` called once
- **Purpose:** the guard attaches only the two fields routes need, not the raw JWT payload (spec §4 step 4).
- **Method:** `authorization: "Bearer " + validToken` where `validToken` was signed with payload `{ id:"u1", username:"amir" }`. Call `requireAuth`.
- **Expected:** `next` called exactly once, with no argument. `req.user` deep-equals `{ id: "u1", username: "amir" }` — **no `iat`, no `exp`**. `res.status` / `res.json` not called.

### RA-05 — expired token → 401
- **Purpose:** an expired access token is rejected (spec §4 step 3).
- **Method:** sign a token with `{ expiresIn: -10 }` (already expired). `authorization: "Bearer " + expiredToken`. Call `requireAuth`.
- **Expected:** `res.status(401)`. `next` not called. (Body string: see RA-06 — `"Invalid or expired token!"`.)

### RA-06 — verify-failure body must be `{ error: "Invalid or expired token!" }`
- **Purpose:** spec `06 §4` step 3 fixes the body for a failed `jwt.verify` as `{ "error": "Invalid or expired token!" }`, distinct from the missing-header case.
- **Method:** sign a token with a **different** secret (`jwt.sign(payload, "wrong-secret")`). `authorization: "Bearer " + tamperedToken`. Call `requireAuth`.
- **Expected:** `res.status(401)`, `res.json({ error: "Invalid or expired token!" })`.
- **Actual (code):** `res.json({ error: "Invalid or expired token!" })` (line 41).
- **Outcome:** **PASS**.

### RA-07 — tampered token → 401, `next` not called
- **Purpose:** a token with a mutated signature does not pass.
- **Method:** take a valid token, flip the last character of its signature segment. `authorization: "Bearer " + mutated`. Call `requireAuth`.
- **Expected:** `res.status(401)`. `next` not called. `req.user` undefined.

### RA-08 — no database call happens
- **Purpose:** the token is self-contained; `requireAuth` must not hit Mongo (spec §4 "Does not touch the database").
- **Method:** spy on `mongoose` model methods is not practical in a pure unit; instead assert structurally: `requireAuth.js` does not `require` any model or the repository. Static check: read the file, assert no `require(` line references `models/` or `dal/` or `mongoose`.
- **Expected:** the only `require` in the file is `jsonwebtoken`.

### RA-09 — a valid token whose payload lacks `username` still sets `req.user` with `username: undefined`
- **Purpose:** documents the exact mapping (`req.user = { id: decoded.id, username: decoded.username }`) — the guard copies two named fields, it does not validate them.
- **Method:** sign `{ id: "u1" }` only. Call `requireAuth`.
- **Expected:** `next` called once. `req.user` deep-equals `{ id: "u1", username: undefined }`.
