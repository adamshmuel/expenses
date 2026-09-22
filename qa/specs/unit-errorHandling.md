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

### EH-05 — `err.code === 11000` → 409, `{ error: "<field> already exists." }`, `logger.warn`
- **Purpose:** duplicate-key errors become a 409 here, once, for every unique-indexed model, with the friendly message naming the field that collided (spec §3.2, `05` decision 3). The field name comes from `err.keyValue`, the object Mongo attaches to a duplicate-key error mapping the colliding field to its value.
- **Method / Expected, three shapes:**
  1. **Duplicate `username`:** `err.keyValue = { username: "amir" }`, `err.code = 11000`. → `res.status(409)`, `res.json({ error: "username already exists." })`, `logger.warn` once, `logger.error` not called.
  2. **Duplicate `email`:** `err.keyValue = { email: "amir@example.com" }`, `err.code = 11000`. → `res.status(409)`, `res.json({ error: "email already exists." })`, `logger.warn` once, `logger.error` not called.
  3. **No `err.keyValue`** (defensive fallback): `err.code = 11000`, no `keyValue` property. → `res.status(409)`, `res.json({ error: "That value already exists." })`, `logger.warn` once, `logger.error` not called.

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

---

## Added 2026-09-17 — the 409 body derived from `err.keyValue`

`backend/error_handling.js` changed this round:

```js
const field = Object.keys(err.keyValue ?? {})[0] ?? "That value";
return res.status(409).json({ error: `${field} already exists.` });
```

It replaced the fixed string `"That username or email is already taken."` and
brings the body back to spec 06 §3.2's `"<field> already exists."`. EH-05 above
covers the shape; these cover the three `keyValue` shapes that actually reach
it. Two of them are unreachable from a real request, which is exactly why they
belong at unit level.

The API-level companions are `RG-15` / `RG-16` in
`qa/specs/regression-2026-09-17.md`.

### EH-12 — the field name comes from `err.keyValue`, not from a constant
- **Purpose:** the fix's whole point. A single case cannot prove a value is
  derived rather than hardcoded — it takes two with different expected values.
- **Under test:** `errorHandler`'s `11000` branch.
- **Method:** unit. Call `errorHandler` twice: once with
  `{ code: 11000, keyValue: { username: "ada" } }`, once with
  `{ code: 11000, keyValue: { email: "ada@example.com" } }`.
- **Expected:** `res.json` receives exactly `{ error: "username already exists." }`
  and `{ error: "email already exists." }` respectively. Both `res.status(409)`.
- **Fails if reverted:** yes — the previous fixed string fails both.
- **Note:** the field name is the raw index key, so the sentence begins
  lowercase (`"username already exists."`). That matches spec 06 §3.2's
  `"<field> already exists."` literally. If Adam would rather it read
  `"Username already exists."`, the spec changes first and then this case —
  `sdd.md`, not the other way round.

### EH-13 — a `11000` with no usable `keyValue` falls back instead of throwing
- **Purpose:** `Object.keys(undefined)` throws. The `?? {}` is the only thing
  between an unusual duplicate-key error and a 500 raised **inside the error
  handler itself** — which would be logged as a server error and would lose the
  original error entirely.
- **Method:** unit. Call `errorHandler` with, in turn:
  `{ code: 11000 }` (no `keyValue`); `{ code: 11000, keyValue: {} }`;
  `{ code: 11000, keyValue: null }`.
- **Expected:** all three → `res.status(409)` and
  `{ error: "That value already exists." }`. No throw. `logger.warn` once,
  `logger.error` zero, in each.

### EH-14 — a compound-index clash names one field and does not throw
- **Purpose:** a compound unique index produces a `keyValue` with two keys.
  `categoryModel` already uses compound indexes, so this shape is reachable as
  the app grows.
- **Method:** unit. `{ code: 11000, keyValue: { user: "u1", name: "Food" } }`.
- **Expected:** 409, a body naming the **first** key (`"user already exists."`),
  no throw.
- **Status:** the message is not good copy for this shape. Recorded as a known
  limitation rather than a failure — spec 06 §3.2 defines the single-field
  case only. Flagged so that whoever adds the next compound index sees it.

### EH-15 — EH-10's "exactly `{ error }`" still holds for all three new shapes
- **Purpose:** the neighbour check. EH-10 collects EH-05, EH-06 and EH-08; the
  409 branch now builds its string dynamically, which is a new way for that
  body to go wrong.
- **Method:** re-run EH-10's collection including EH-12, EH-13 and EH-14.
- **Expected:** every argument has exactly one own key, `error`, a non-empty
  string. No `undefined` ever appears inside the string — a template literal
  over a missing field would produce `"undefined already exists."`, which is
  the specific regression this guards.
