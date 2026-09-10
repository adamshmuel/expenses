# 07 — The server entry point: `index.js`

Status: **draft — needs Adam's approval.**

`backend/index.js` is the file that assembles the server: it loads the
environment, builds the Express app, mounts every middleware and router in the
right order, connects to the database, and starts listening.

It contains **no business logic of its own**. Every piece it wires in is
specified elsewhere:

| Piece | Spec |
|---|---|
| `.config/logger.js`, `.config/db.js`, `error_handling.js`, `requireAuth` | [06-server-modules.md](06-server-modules.md) |
| the `/users` router and its handlers | [05-user-layers.md](05-user-layers.md) |
| the API contract the whole app answers to | [03-api-contract.md](03-api-contract.md) |

Adam writes this file himself. This spec fixes **what is mounted, in what
order, and why** — not the exact code.

Course topics: demo 9 (Express basics), 14/16 (middleware, error handler),
17 (CORS, dotenv), 21 (morgan → Winston), 24 (helmet, rate limit), 27 (CORS
locked to an origin).

---

## 1. Start-up order

`index.js` runs these steps, in this order. The order matters — several steps
depend on an earlier one having run.

1. **Load `dotenv`** — `require("dotenv").config()` as the very first line, before
   any other `require` that reads `process.env`. This is why the `dotenv` call
   currently inside `.config/db.js` moves here ([06](06-server-modules.md)
   deferred item).
2. **Build the app** — `const app = express()`.
3. **Mount middleware** — in the order in §2.
4. **Mount routers** — §3.
5. **Mount the 404 handler**, then **the central error handler** — §4. These come
   after every route.
6. **Connect to the database** — `connectDB()` from `.config/db.js`. It logs
   success or exits the process on failure.
7. **Start listening** — `app.listen(process.env.PORT, ...)`, log one `info`
   line with the port.

Whether step 6 is awaited before step 7, or just called, is a small choice —
either is fine, because `connectDB` exits the process itself on failure. Calling
it right before `listen` is simplest.

---

## 2. Middleware, in order

Every `app.use(...)` line, top to bottom. Each entry says why it sits where it
does.

| # | Middleware | Why here |
|---|---|---|
| 1 | `helmet()` | Sets safe HTTP response headers. First, so it covers every response including errors. Demo 24. |
| 2 | `cors({ origin: process.env.CLIENT_ORIGIN, credentials: true })` | Must run before any route. `credentials: true` + an **exact** origin (not `*`) because the client sends the refresh cookie. If this is wrong, login seems to work and the refresh silently fails ([03](03-api-contract.md) §0). Demo 27. |
| 3 | `express.json()` | Parses JSON request bodies into `req.body`. Before any route that reads a body (all of `/users`). |
| 4 | `cookie-parser` | Populates `req.cookies`, which `/users/refresh` and `/users/logout` read ([05](05-user-layers.md) §6.1). Before the routers. |
| 5 | request logging: `morgan` piped into the Winston logger | One line per request at `http` level, into `logs/app.log`. Piped through Winston (not morgan's own file) so all logs share one format and destination set ([06](06-server-modules.md) §1). Demo 21. |
| 6 | global rate limiter: a **loose** `express-rate-limit` on all routes | A blanket ceiling against abuse. The **strict** limiter on `/users/login` is separate and already lives in `userRoute.js` ([05](05-user-layers.md) §6) — this global one is much more permissive. Demo 24. |

### CSRF

No CSRF library in v1. The refresh token is an HttpOnly cookie with
`sameSite: "lax"`, which itself stops a cross-site POST from carrying the cookie
— that is the modern CSRF defense. If the app is ever deployed on a public
domain, revisit with `csrf-csrf` (the maintained successor to the deprecated
`csurf`) using the double-submit-cookie pattern. Noted, not built.

### Static files

No `express.static` in v1. The client is a separate Vite app on `:5173`; the
server is API-only. `express.static` gets added only if the built client is
later served from this same server (deployment). Deferred, per
[product-first.md](../../.claude/rules/product-first.md) — no empty hook just to
tick demo 17.

---

## 3. Routers

| Mount path | Router | Spec | v1? |
|---|---|---|---|
| `/users` | `routes/userRoute.js` | [05-user-layers.md](05-user-layers.md) | **yes** |
| `/chat` | `routes/chatRoute.js` | not yet specified | later |
| `/expenses` | `routes/expenseRoute.js` | not yet specified | later |

Only `/users` is mounted now. There is **no `/api` prefix** — the server serves
this one API and nothing else ([03](03-api-contract.md)). So the live endpoints
are exactly `/users/signup`, `/users/login`, `/users/refresh`, `/users/logout`.

`/chat` and `/expenses` will be protected by `requireAuth`
([06](06-server-modules.md) §4) when they are added; `/users` is not.

---

## 4. The tail: 404, then the error handler

After every router, in this order:

1. **A 404 handler** — a middleware that runs when no route matched. It responds
   `404` with the general error shape `{ "error": "Not found." }`
   ([03](03-api-contract.md) §0). It can do this directly, or create an error
   with `status = 404` and pass it to `next` so the central handler formats it —
   either is fine; the response shape is what matters.
2. **`errorHandler`** from `error_handling.js` — the 4-argument central handler,
   registered **last**. It is the only place a thrown error becomes a response
   ([06](06-server-modules.md) §3). Its logging is already handled inside that
   module.

---

## 5. What `index.js` must not do

- No route handlers written inline — they live in router files.
- No database queries — those are the repository's job.
- No `try/catch` around business logic — `catchAsync` and `errorHandler` cover
  it.
- No reading `process.env` scattered through the file beyond the start-up values
  (`PORT`, `CLIENT_ORIGIN`). Secrets are read where they are used
  (`JWT_SECRET` in `userService` / `requireAuth`, etc.).

---

## 6. Environment variables this file reads

From the [06](06-server-modules.md) §5 `.env` contract, `index.js` itself uses:

| Variable | Used for |
|---|---|
| `PORT` | `app.listen` — the client expects `3000` |
| `CLIENT_ORIGIN` | the `cors` origin — exactly `http://localhost:5173` in dev |
| `MONGODB_URI` | passed through `connectDB()` (read inside `db.js`, listed here for completeness) |

`.env.example` is created and committed alongside this file, mirroring the full
contract in [06](06-server-modules.md) §5 with placeholder values. `.env` itself
is never committed.

---

## 7. Open questions

None.

---

## 8. Course-topic coverage

| Topic | Demo | Where in `index.js` |
|---|---|---|
| Express basics | 9 | `express()`, `app.listen` |
| Middleware | 14 | the whole §2 stack |
| Error handling | 16 | the 404 handler + `errorHandler` last |
| CORS, dotenv | 17 | `dotenv` first line, `cors` at §2 #2 |
| morgan → Winston | 21 | request logging, §2 #5 |
| Advanced security | 24 | `helmet`, global rate limiter |
| CORS locked to an origin | 27 | `cors` with an exact `CLIENT_ORIGIN` |
