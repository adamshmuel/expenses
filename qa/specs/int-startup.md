# Test spec — `index.js` start-up sequence (integration, child process)

**Under test:** `backend/index.js` — the assembled server's start-up order.
**Governing spec:** `docs/specs/07-server-entry.md` §1; `docs/specs/06-server-modules.md` §2.
**Level:** integration. The QA harness (`qa/harness/server.ts`) already spawns `node backend/index.js`; these tests use that harness plus one extra spawn with a broken DB URI.
**Automation:** `qa/tests/integration/startup.test.ts` (reuses the harness).

---

### ST-01 — `dotenv` is loaded before anything reads `process.env`; the server boots with `.env`-style values
- **Purpose:** spec §1 step 1 — `require("dotenv").config()` is the very first line.
- **Method:** spawn `node backend/index.js` with the environment: `MONGODB_URI` = test URI, `PORT` = 3100, `CLIENT_ORIGIN` = `http://localhost:5173`, `JWT_SECRET` / `REFRESH_TOKEN_SECRET` from the process env the harness inherited from `backend/.env`. Wait for the readiness log line.
- **Expected:** stdout contains `Server running on http://localhost:3100` within the timeout, i.e. `process.env.PORT` was read successfully. A follow-up `POST /users/login` with a missing body returns a well-formed `400` (proving `express.json` and the router mounted). Reading `index.js` statically: line 1 (ignoring the license comment block) is `require("dotenv").config();` before any other `require`.

### ST-02 — the server starts listening only after `connectDB()` is invoked
- **Purpose:** spec §1 steps 6–7 — connect, then listen.
- **Method:** static + behavioural. Static: in `index.js`, the `connectDB()` call appears before `app.listen(`. Behavioural: with a valid test URI, once `Server running…` is logged, a `GET /users/anything` returns a JSON response (404 shape) rather than a connection error, and within a few seconds the log also shows `connected to MongoDB`.
- **Expected:** both hold. (Spec §1 explicitly allows `connectDB` to be called, not awaited, right before `listen`.)

### ST-03 — a failed DB connection exits the process instead of serving 500s
- **Purpose:** spec §1 step 6 / `06` §2 step 4 — no DB ⇒ no server.
- **Method:** spawn `node backend/index.js` with `MONGODB_URI = "mongodb://127.0.0.1:59999/nope?serverSelectionTimeoutMS=3000"` and `PORT = 3101`. Do **not** send any request. Wait up to 15 s for the child to exit.
- **Expected:** the child process exits with a non-zero code. Its output contains `Error connecting to MongoDB`. (`app.listen` may briefly bind before Mongoose gives up; the pass condition is that the process does not stay alive.)
- **Known nuance:** `index.js` calls `connectDB()` then `app.listen()` synchronously, so the port can open ~before the connection fails. The spec's intent — "a server with no database should not stay up" — is met by the `process.exit(1)` inside `connectDB`'s `.catch`. This test asserts the process death, not that the port never opened.
