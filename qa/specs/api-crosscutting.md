# Test spec — cross-cutting HTTP behaviours (api)

**Under test:** the running server as a whole — error-response contract, credential-leak surface, security headers, CORS, 404, and observable middleware-order effects.
**Governing spec:** `docs/specs/03-api-contract.md` §0; `docs/specs/07-server-entry.md` §2 and §4; `docs/specs/01-ai-chat.md` §2; `docs/specs/05-user-layers.md` §5; `docs/specs/06-server-modules.md` §3.
**Level:** api — real HTTP against the spawned server on `PORT 3100`.
**Automation:** `qa/tests/api/crosscutting.test.ts`.

---

### XC-01 — every error body is one of exactly two shapes
- **Purpose:** spec `03` §0 — the client understands only `{ error: string }` or `{ errors: [{ field, message }] }`.
- **Method:** collect error responses from: `POST /users/login` with `{}` (400), `POST /users/login` wrong creds (401), `POST /users/signup` with `{}` (400), `POST /users/refresh` no cookie (401), `GET /nope` (404). For each, parse JSON.
- **Expected:** each body has **either** exactly the key `error` (string) **or** exactly the key `errors` (array of objects each with exactly `field` + `message`). No body has both, and no body has any third top-level key.

### XC-02 — `field` values in a validation error match request body keys exactly
- **Purpose:** spec `03` §0 — the client puts the message under the input named by `field`.
- **Method:** `POST /users/signup` with `username:"ab"`, `email:"bad"`, `password:"x"`.
- **Expected:** HTTP `400`; every `errors[].field` is one of `"username"`, `"email"`, `"password"`.

### XC-03 — no successful response body ever contains `password` or a bcrypt hash
- **Purpose:** spec `01` §2, `03` §1, `05` §5.
- **Method:** capture the success bodies of `POST /users/signup` (201), `POST /users/login` (200), `POST /users/refresh` (200). Stringify each; search for `password`, `$2a$`, `$2b$`, `$2y$`.
- **Expected:** none present in any of the three.

### XC-04 — `refreshToken` never appears in a JSON body (only in `Set-Cookie`)
- **Purpose:** spec `05` §5.
- **Method:** from the same three success responses, stringify each body; search for `refreshToken`. Separately confirm the `set-cookie` header **does** carry it.
- **Expected:** `refreshToken` absent from every body; present in `set-cookie` on signup/login/refresh.

### XC-05 — `helmet` security headers are present on a success response
- **Purpose:** spec `07` §2 #1 — helmet is mounted so it covers every response.
- **Method:** `POST /users/signup` (201), inspect response headers.
- **Expected:** `x-content-type-options: nosniff` present; `x-dns-prefetch-control` present; a `content-security-policy` header present; `x-powered-by` **absent** (helmet removes it).

### XC-06 — `helmet` headers are present on an error response too
- **Purpose:** spec `07` §2 #1 — "including errors".
- **Method:** `GET /nope` (404), inspect headers.
- **Expected:** `x-content-type-options: nosniff` present; `x-powered-by` absent.

### XC-07 — CORS: exact origin echoed, credentials allowed
- **Purpose:** spec `03` §0 / `07` §2 #2 — `cors({ origin: 'http://localhost:5173', credentials: true })`, not `*`.
- **Method:** `POST /users/login` with request header `Origin: http://localhost:5173`.
- **Expected:** response header `access-control-allow-origin: http://localhost:5173` (exact, not `*`) and `access-control-allow-credentials: true`.

### XC-08 — CORS preflight (`OPTIONS`) is answered for the client origin
- **Method:** `OPTIONS /users/login` with `Origin: http://localhost:5173` and `Access-Control-Request-Method: POST`.
- **Expected:** a 2xx/204 status; `access-control-allow-origin: http://localhost:5173`; `access-control-allow-credentials: true`.

### XC-09 — a foreign origin does not get its origin echoed
- **Purpose:** `07` §27 — CORS locked to one origin.
- **Method:** `POST /users/login` with `Origin: http://evil.example`.
- **Expected:** the response does **not** carry `access-control-allow-origin: http://evil.example`. (`cors` omits the header or sends the configured origin; either way `evil.example` is never echoed.)

### XC-10 — an unmatched path returns 404 with the general error shape
- **Purpose:** spec `07` §4 #1.
- **Method:** `GET /this/does/not/exist`.
- **Expected:** HTTP `404`; body has exactly one key `error` (a string).

### XC-11 — the 404 body message is `"Not Found"`
- **Purpose:** spec `07` §4 #1 fixes the 404 body as `{ "error": "Not Found" }`.
- **Method:** from XC-10, read `body.error`.
- **Expected:** `body.error === "Not Found"`.
- **Actual (code, as of 2026-09-17):** `index.js`'s 404 handler now returns `{ error: "Not found." }` (lowercase, trailing period). `docs/specs/07-server-entry.md` §4 was not updated to match and still requires `"Not Found"`.
- **Outcome:** **FAIL**. See `qa/specs/README.md` "2026-09-17 QA note" — not changed to match the code pending a decision from Adam on whether the spec or the code is the one that's wrong here.

### XC-12 — JSON body parsing and cookie parsing are wired (middleware order effect)
- **Purpose:** spec `07` §2 #3–#4 — `express.json` before the routers, `cookie-parser` before `/users/refresh`.
- **Method:** (a) `POST /users/login` with a JSON body and `Content-Type: application/json` → the server reads `req.body` (a `400` validation response proves the body was parsed, not a crash). (b) `POST /users/refresh` with a `Cookie: refreshToken=x` header → the server reads `req.cookies` and returns a JSON `401` (not a 500).
- **Expected:** (a) `400` with the `errors` shape. (b) `401` with the `error` shape — never a `500`/`TypeError`.

### XC-13 — middleware order: `helmet` vs `compression` — DESIGN NOTE
- **Purpose:** spec `07` §2 lists `helmet()` as middleware **#1** ("First, so it covers every response"). The code mounts `compression()` first (line 30) and `helmet()` second (line 31).
- **Method:** static read of `index.js` — record the order of the `app.use(` lines. Behaviourally, confirm helmet headers are still present on every response (covered by XC-05/06).
- **Expected:** helmet headers present on all responses (PASS). The ordering difference is recorded as **design note XC-13**: `compression()` does not send a response of its own, so mounting it before `helmet()` does not leave any response un-helmeted. Not a functional failure; flagged so Adam can align the code with the spec's stated order or update the spec.

### XC-14 — a global rate limiter is present and looser than the login limiter
- **Purpose:** spec `07` §2 #6 — a loose blanket limiter distinct from the strict `/users/login` one.
- **Method:** static + light behavioural. Static: `index.js` constructs a `rateLimit({ windowMs: 15*60*1000, max: 300, ... })` and `app.use`s it before the routers. Behavioural: send 15 rapid `GET /` requests; none should be `429` (the global ceiling is 300, the login ceiling is 5 — 15 non-login requests stay well under 300).
- **Expected:** static config found with `max: 300`; the 15 requests all return a non-429 status (404 is fine — the path is unmatched).
