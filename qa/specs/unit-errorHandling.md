# Test spec — `error_handling.js` (unit)

**Under test:** `backend/error_handling.js` — `catchAsync(handler)` and `errorHandler(err, req, res, next)`.
**Governing spec:** `docs/specs/06-server-modules.md` §3; `docs/specs/03-api-contract.md` §0; `docs/specs/05-user-layers.md` §8, §10 decision 3.
**Level:** unit. The logger (`.config/logger.js`) is mocked (`vi.mock`) so `logger.warn` / `logger.error` are spies. Fake `req` = `{ method:"POST", originalUrl:"/users/signup" }`, fake `res` = `{ status: vi.fn().mockReturnThis(), json: vi.fn() }`, fake `next` = `vi.fn()`.
**Automation:** `qa/tests/unit/errorHandling.test.ts`.

---

## `catchAsync`

### EH-01 — a rejecting handler forwards the error via `next(err)`
- **Purpose:** an async throw does not crash the process; it reaches the central handler (spec §3.1).
- **Method:** `const boom = new Error("kaboom"); const wrapped = catchAsync(async () => { throw boom; });` Call `wrapped(req, res, next)`, await a tick.
- **Expected:** `next` called exactly once with `boom` (same reference). `res.status` / `res.json` never called.

### EH-02 — a resolving handler does not call `next`
- **Purpose:** the wrapper is transparent on the happy path.
- **Method:** `const wrapped = catchAsync(async (req, res) => { res.json({ ok: true }); });` Call it, await a tick.
- **Expected:** `next` not called. `res.json({ ok: true })` called once (by the handler itself).

### EH-03 — `catchAsync` logs nothing
- **Purpose:** logging happens once, in `errorHandler` only (spec §3.3, decision 2 — "no error is logged twice").
- **Method:** as EH-01. After the tick, inspect the logger spies.
- **Expected:** `logger.warn`, `logger.error`, `logger.info`, `logger.http` all zero calls.

### EH-04 — a synchronously-throwing handler is also caught
- **Purpose:** `Promise.resolve(handler(...))` still catches a sync throw inside an `async` handler; documents the boundary.
- **Method:** `const wrapped = catchAsync(async () => { JSON.parse("{"); });` Call it, await a tick.
- **Expected:** `next` called once with a `SyntaxError`.

## `errorHandler`

### EH-05 — `err.code === 11000` → 409, `{ error }` shape, `logger.warn` — SPEC WORDING NOTE
- **Purpose:** duplicate-key errors become a 409 here, once, for every unique-indexed model (spec §3.2, `05` decision 3).
- **Method:** `const err = Object.assign(new Error("E11000 duplicate key error ... username_1"), { code: 11000 });` Call `errorHandler(err, req, res, next)`.
- **Expected:** `res.status(409)`. `res.json` called once with an object whose only key is `error` and whose value is a string. `logger.warn` called once; `logger.error` not called.
- **Note:** spec §3.2 table gives the message as `"<field> already exists."`; the code returns `"That username or email is already taken."`. The **status and shape are asserted** (both correct); the exact wording is recorded as divergence EH-05, not failed.

### EH-06 — `err.status` set → that status + `{ error: err.message }` + `logger.warn`
- **Purpose:** a deliberate error (e.g. 401 from `userService.login`) is passed through with its chosen message (spec §3.2 row 2, §3.3).
- **Method:** `const err = Object.assign(new Error("Username or password is incorrect."), { status: 401 });` Call `errorHandler`.
- **Expected:** `res.status(401)`, `res.json({ error: "Username or password is incorrect." })`. `logger.warn` called once; `logger.error` not called.

### EH-07 — a 400 with `err.status` is logged at `warn`, not `error`
- **Purpose:** deliberate 4xx keep `error.log` clean (spec §3.3).
- **Method:** `const err = Object.assign(new Error("bad"), { status: 400 });` Call `errorHandler`.
- **Expected:** `res.status(400)`, `res.json({ error: "bad" })`. `logger.warn` once, `logger.error` zero.

### EH-08 — no `status`, no `code` → 500 + generic body + `logger.error`
- **Purpose:** an unexpected error is a 5xx and is logged as a real problem (spec §3.2 row 3, §3.3).
- **Method:** `const err = new Error("connection reset by peer");` Call `errorHandler`.
- **Expected:** `res.status(500)`, `res.json({ error: "Something went wrong." })`. `logger.error` called once; `logger.warn` not called.

### EH-09 — the 500 branch never puts `err.message` in the response body
- **Purpose:** the real failure message is logged, not sent to the client (spec §3.2 row 3, "the real one is logged, not sent").
- **Method:** `const err = new Error("SECRET table `users` missing column `ssn`");` Call `errorHandler`. Inspect the object passed to `res.json`.
- **Expected:** `res.json` argument is exactly `{ error: "Something went wrong." }`. The string `"SECRET"` does **not** appear anywhere in the JSON argument. `logger.error`'s first argument **does** contain the real message.

### EH-10 — every `errorHandler` response body is exactly `{ error: <string> }`
- **Purpose:** the handler only ever emits the general shape; the `{ errors: [] }` shape is produced earlier by validators and never reaches here (spec §3.2 "Key points").
- **Method:** run EH-05, EH-06, EH-08 and collect each `res.json` argument.
- **Expected:** each argument has exactly one own key, `error`, whose value is a non-empty string. No `errors` key anywhere.

### EH-11 — `errorHandler` logs exactly once per call
- **Purpose:** no double logging (decision 2).
- **Method:** for each of the three branches, sum all logger spy call counts after one `errorHandler` call.
- **Expected:** total logger calls === 1 in every branch (warn for 11000/`status`, error for the fallback).
