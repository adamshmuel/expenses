# 06 — Server modules: logger, DB, error handling, requireAuth

Status: **agreed. The four modules are written and match this spec.**

The self-contained pieces the server is built from — each one a file that
exports a function or object, understandable and testable on its own. How they
are wired together (order of `app.use`, mounting routers, `app.listen`) is a
**separate spec** for `index.js`, written later.

```
index.js  ──imports──┬─ .config/logger.js
                     ├─ .config/db.js
                     ├─ error_handling.js        (catchAsync + errorHandler)
                     └─ middleware/requireAuth.js
```

Adam writes all four files himself. This spec says **what each one does, what it
takes in, and what it gives back** — not how to write the code.

Course topics covered here: demo 16 (error handling), demo 20 (middleware
factory), demo 21 (Winston), demo 17/18 (dotenv + Mongoose connection).

---

## 1. `.config/logger.js` — the Winston logger

One shared logger instance, imported wherever something needs to be logged. From
[01-ai-chat.md](01-ai-chat.md) §9: a request log, a **separate error log file**,
and AI calls logged apart from the rest.

### What it exports

A single configured Winston logger (`module.exports = logger`). Callers use
`logger.info(...)`, `logger.error(...)`, `logger.http(...)`.

### Levels

| Level | Used for |
|---|---|
| `http` | one line per incoming request (the request log) |
| `info` | notable events — server started, DB connected |
| `warn` | recovered-from problems |
| `error` | anything that produced a 5xx, or an uncaught failure |

The logger's minimum level is `http`, so every level above it is also recorded.

### Destinations (transports)

The same log line goes to every destination that accepts its level.

| Destination | Records |
|---|---|
| Console | everything, for local development |
| `logs/app.log` | everything |
| `logs/error.log` | **`error` level only** — the separate error log the briefs require |
| `logs/ai.log` | **only lines tagged `area: "ai"`** — the AI-call log (see below) |

### The AI-call log

[01-ai-chat.md](01-ai-chat.md) §9 asks for AI calls to be "logged apart".
**Decided:** they go to their own file, `logs/ai.log`.

- Call sites still use the normal logger, adding an `area: "ai"` field:
  `logger.info("gemini call", { area: "ai", ms, ok })`.
- A transport (or a small second logger) filtered to `area === "ai"` writes
  those lines to `logs/ai.log`. They still also appear in `logs/app.log`; what
  matters is that `ai.log` on its own is the full, uncluttered AI history to
  read when a draft comes out wrong.
- What an AI line records is `backend/ai/`'s concern, not this module's — this
  module only provides the destination.

### Line format

Each line: a timestamp, the level, the message, and any structured fields
(method, path, status, stack) as JSON. Human-readable in the console, greppable
in the files.

### Crash handlers

Winston's `exceptionHandlers` and `rejectionHandlers` write uncaught exceptions
and unhandled promise rejections to their own files, so a crash is never silent.

### Not this module's job

- Deciding *when* to log a request — that is the request-logging middleware,
  mounted in `index.js`.
- Rotating or deleting old log files. Out of scope for v1 (the briefs mention
  `winston-daily-rotate-file`; not needed for a 6-day local project).

---

## 2. `.config/db.js` — the MongoDB connection

Opens the database connection once, at start-up. Mongoose keeps a single shared
connection pool, so every model reuses it — nothing passes a connection around.

### What it does

1. Reads the connection string from `process.env.MONGODB_URI`.
2. Calls `mongoose.connect(...)` with it.
3. On success — logs one `info` line ("connected to MongoDB").
4. On failure — logs an `error` line **and** the process exits. A server with no
   database cannot serve any route, so starting it would only produce a wall of
   500s.

### What it exports

A `connectDB()` function that `index.js` calls (decision 3) — not a side effect
on `require`. Keeps start-up order explicit and is testable.

### Uses

`process.env.MONGODB_URI`, `mongoose`, and the logger from §1. Nothing else.

### Not this module's job

- Defining schemas or models — those are [04-data-model.md](04-data-model.md),
  in `backend/models/`.
- Seeding data.

---

## 3. `error_handling.js` — `catchAsync` and the central error handler

One file, two exports, as in Adam's `ex6_mongodb`. This is course demo 16.

### 3.1 `catchAsync(handler)`

Wraps an `async` route handler so a rejected promise does not crash the server.

- **Input:** an `async (req, res, next) => {}` handler.
- **Returns:** a plain `(req, res, next)` function that runs the handler and, if
  it throws or rejects, forwards the error with `next(err)`.
- It does **not** decide the status or the response body — that is the central
  handler's single job. It does **not** log either — logging happens once, in
  `errorHandler` (decision 2). `catchAsync` is now just a `.catch(next)` wrapper.

Every route handler in the app is wrapped in this.

### 3.2 `errorHandler(err, req, res, next)` — the one central handler

A 4-argument function (Express recognises that signature as error middleware).
`index.js` registers it **last**, after all routes. It is the only place in the
app that turns a thrown error into an HTTP response.

It maps the error to a status like this:

| Condition on `err` | Status | Response body |
|---|---|---|
| `err.code === 11000` (MongoDB duplicate key) | **409** | `{ "error": "<field> already exists." }` — a friendly message, not the raw Mongo string |
| `err.status` is set (e.g. `401` from `userService.login`) | that number | `{ "error": err.message }` |
| anything else | **500** | `{ "error": "Something went wrong." }` — a generic message; the real one is logged, not sent |

Key points:

- The `11000` case is handled **here, once**, not in any service
  ([05-user-layers.md](05-user-layers.md) decision 3). It covers `User` and any
  future model with a `unique` index.
- The fallback is **500**, not 400. An error that reached here without a
  `.status` is an unexpected failure, and 5xx is what the client's
  refresh-and-retry logic and the operator both expect.
- The body is always one of the two shapes from
  [03-api-contract.md](03-api-contract.md) §0: `{ error }` here, or `{ errors: [] }`
  (which is produced earlier, by the validation middleware in the route, and
  never reaches this handler).

### 3.3 What gets logged

Logging happens **once, here** — `catchAsync` does not log (decision 2).

- The 500 fallback case is logged at `error` level, with method, path, and
  stack. This is what lands in `logs/error.log`.
- A 4xx that carries a deliberate `err.status` (401 bad credentials, 400
  validation) and the 409 duplicate case are expected outcomes, not faults.
  They are logged at `warn`, never `error` — `error.log` stays a list of real
  problems.
- The no-cookie 401 on `POST /users/refresh` never reaches this handler at all
  ([05-user-layers.md](05-user-layers.md) §6): the route answers it directly so
  it is not logged as an error. That behaviour stays in the route; this handler
  does not need to know about it.

### Uses

The logger from §1. Nothing else — it must not import a model or a service.

---

## 4. `middleware/requireAuth.js` — the access-token guard

Protects every route that works with a specific user's data: `/chat/*`,
`/expenses/*`. The four `/users/*` endpoints do **not** use it — logging in is
how you get a token in the first place.

This is real product need, not just demo 14/20: every query in the app is
"filtered by the logged-in user first" ([04-data-model.md](04-data-model.md)),
and something has to establish who that is on each request. The access token is
the proof; this middleware is the one place that checks it.

### What it does, per request

1. Read the `Authorization` header. Expect `Bearer <token>`.
2. No header, or not in that form → **401** `{ "error": "Not authenticated." }`,
   and `next()` is **not** called (the route never runs).
3. `jwt.verify(token, process.env.JWT_SECRET)`. If it throws (expired, tampered,
   wrong secret) → **401** `{ "error": "Not authenticated." }`.
4. On success, put the token's payload on the request as `req.user`:

   ```js
   req.user = { id: <from token>, username: <from token> }
   ```

   That payload shape is fixed by [05-user-layers.md](05-user-layers.md) §4 —
   the access token is signed as `{ id, username }`. Routes downstream read
   `req.user.id` to scope their queries.
5. `next()`.

### Factory or plain middleware

A plain `requireAuth(req, res, next)` function (decision 4). Adam's `ex6_mongodb`
uses a factory (`requireRole('admin')`, demo 20), but this app has no roles in
v1, so the factory layer would wrap nothing.

### The 401 here vs. the 401 on `/refresh`

Both say "you are not logged in", but they are different moments:

| | `requireAuth` 401 | `/users/refresh` 401 |
|---|---|---|
| When | access token missing or expired on a protected route | no refresh cookie, or refresh token invalid |
| Client's reaction | try `/users/refresh` once, then retry the original request | give up, show the login screen |

`requireAuth` just returns the 401. It does **not** try to refresh — that is the
client's job ([03-api-contract.md](03-api-contract.md) §1).

### Uses

`jsonwebtoken`, `process.env.JWT_SECRET`. It does not touch the database — the
token is self-contained, and a DB lookup on every protected request is a cost
this app does not need in v1.

### Not this module's job

- Refreshing tokens.
- Checking whether the user still exists or is banned — v1 has no such state.
- Rate limiting — separate middleware.

---

## 5. The `.env` contract

The server reads these variables. `.env` holds the real values and is **never
committed** (it has database credentials, JWT secrets, and the Gemini key).
`.env.example` is committed with the same keys and placeholder values, so anyone
setting up the project knows what to provide.

| Variable | Used by | Notes |
|---|---|---|
| `MONGODB_URI` | `.config/db.js` | full connection string, includes credentials |
| `JWT_SECRET` | `userService`, `requireAuth` | signs and verifies the **access** token |
| `REFRESH_TOKEN_SECRET` | `userService` | signs and verifies the **refresh** token — a different value from `JWT_SECRET` |
| `PORT` | `index.js` | the server's port; the client expects `3000` |
| `GEMINI_API_KEY` | `backend/ai/` | never sent to the client |
| `CLIENT_ORIGIN` | `index.js` (CORS) | exactly `http://localhost:5173` in dev |

`dotenv` is loaded once, as early as possible, before any module reads
`process.env`.

---

## 6. Decisions

1. **AI-call log:** its own file, `logs/ai.log`, fed by lines tagged
   `area: "ai"`. The shared line format is applied to it too. (§1)
2. **Where logging lives:** only in `errorHandler`. `catchAsync` forwards with
   `next(err)` and does not log — no error is logged twice. (§3.3)
3. **`db.js` shape:** a `connectDB()` function `index.js` calls, exported as
   `{ connectDB }`. Not a connect-on-`require` side effect. (§2)
4. **`requireAuth`:** a plain `(req, res, next)` function, no factory. (§4)

### Deferred to the `index.js` spec

- `dotenv` is currently loaded inside `.config/db.js`. It moves to the top of
  `index.js`, before any module reads `process.env`, and comes out of `db.js`.
- `.env.example` is written and committed alongside the `index.js` work, once
  `PORT` and `CLIENT_ORIGIN` have a consumer.

---

## 7. Course-topic coverage

| Topic | Demo | Where |
|---|---|---|
| Middleware | 14 | `requireAuth`, `catchAsync` |
| Error handling, `catchAsync` | 16 | `error_handling.js` |
| CORS, static, dotenv | 17 | the `.env` contract; CORS itself is wired in `index.js` |
| Mongoose connection | 18 | `.config/db.js` |
| bcrypt + JWT | 19 | `requireAuth` verifies the JWT |
| Middleware factory, roles | 20 | `requireAuth` may be written as a factory |
| Winston, separate error log | 21 | `.config/logger.js` |
| Advanced security | 24 | `error_handling.js` 409 mapping; the `.env` split for secrets |
