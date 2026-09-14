# Test spec — `.config/db.js` (integration, child process)

**Under test:** `backend/.config/db.js` — `connectDB()`.
**Governing spec:** `docs/specs/06-server-modules.md` §2 and §6 decision 3.
**Level:** integration. `connectDB` calls `process.exit(1)` on failure, so it must run in a **child process** (`child_process.fork`/`spawn` of a tiny driver script under `qa/harness/`). The driver `require`s `backend/.config/db.js`, calls `connectDB()`, and after a delay calls `process.exit(0)` if still alive. The test inspects the child's exit code and stdout/stderr.
**Automation:** `qa/tests/integration/db.test.ts` + `qa/harness/db-driver.js`.

Note: the driver needs `dotenv` loaded (the real `index.js` does this; `db.js` alone does not). The driver sets `process.env.MONGODB_URI` explicitly from the test, so no `.env` read is required.

---

### DB-01 — a good URI connects and logs one `info` line
- **Purpose:** happy path (spec §2 step 3).
- **Method:** fork the driver with `MONGODB_URI` = the derived test URI (`…/expenses_qa_test`) and a flag telling it to exit 0 after 4 s. Capture stdout (the Winston Console transport writes there).
- **Expected:** child exits with code `0`. Combined output contains `connected to MongoDB` and `[INFO]`. It does **not** contain `[ERROR]`.

### DB-02 — a bad URI logs an `error` line and exits non-zero
- **Purpose:** a server with no database must not stay up (spec §2 step 4, decision 3).
- **Method:** fork the driver with `MONGODB_URI = "mongodb://127.0.0.1:59999/nope"` (nothing listening) and `serverSelectionTimeoutMS` short via the URI query `?serverSelectionTimeoutMS=3000`. Wait for the child to exit.
- **Expected:** child exits with code `1`. Output contains `Error connecting to MongoDB` and `[ERROR]`.

### DB-03 — `db.js` exports only `connectDB` and defines no models
- **Purpose:** scope (spec §2 "Not this module's job").
- **Method:** `require("backend/.config/db.js")` in-process and inspect. Also check `mongoose.modelNames()` is unchanged by the require.
- **Expected:** exports are exactly `{ connectDB }`. `require`-ing the file registers no Mongoose models.
