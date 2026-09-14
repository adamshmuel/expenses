# Test spec — `.config/logger.js` (integration)

**Under test:** `backend/.config/logger.js` — the shared Winston logger, its transports and filters.
**Governing spec:** `docs/specs/06-server-modules.md` §1 and §6 decision 1; `docs/specs/01-ai-chat.md` §9.
**Level:** integration against a **temporary log directory**. The logger writes relative paths (`./logs/app.log` etc.), so the test `chdir`s into a fresh temp dir (`fs.mkdtempSync`) before `require`-ing the module with a cache-bust, writes lines, flushes, then reads the files back. Restores `cwd` and removes the temp dir in teardown.
**Automation:** `qa/tests/integration/logger.test.ts`.

Helper: `flush()` — resolve after `logger.on("finish")` or a 150 ms timer, since Winston file writes are async.

---

### LG-01 — an `error` line reaches both `error.log` and `app.log`
- **Purpose:** the separate error log is a filter, not a redirect — errors still go to the everything-log (spec §1 "same log line goes to every destination that accepts its level").
- **Method:** in the temp cwd, `logger.error("disk fell off", { path: "/x" })`. `flush()`. Read `logs/error.log` and `logs/app.log`.
- **Expected:** both files contain a line with `disk fell off` and `[ERROR]`.

### LG-02 — a `warn` line reaches `app.log` but **not** `error.log`
- **Purpose:** `error.log` stays a list of real problems (spec §3.3 rationale, §1 table).
- **Method:** `logger.warn("recovered ok")`. `flush()`. Read both files.
- **Expected:** `app.log` contains `recovered ok` `[WARN]`; `error.log` does **not** contain `recovered ok`.

### LG-03 — a line tagged `{ area: "ai" }` reaches `ai.log`
- **Purpose:** the AI-call log is fed by the `area === "ai"` filter (spec §1 "The AI-call log", decision 1).
- **Method:** `logger.info("gemini call", { area: "ai", ms: 42, ok: true })`. `flush()`. Read `logs/ai.log`.
- **Expected:** `ai.log` contains a line with `gemini call` and `"ms":42`.

### LG-04 — a line **without** `area: "ai"` does **not** reach `ai.log`
- **Purpose:** `ai.log` on its own is the uncluttered AI history (spec §1).
- **Method:** `logger.info("server started")` (no `area`). `flush()`. Read `logs/ai.log`.
- **Expected:** `ai.log` does not contain `server started`. (And `app.log` does.)

### LG-05 — an AI line also appears in `app.log`
- **Purpose:** spec §1 — AI lines "still also appear in `logs/app.log`".
- **Method:** from LG-03's write, read `app.log`.
- **Expected:** `app.log` contains `gemini call`.

### LG-06 — a line with empty meta prints no trailing `{}`
- **Purpose:** the shared line format only appends JSON when there are extra fields (`logger.js` `Object.keys(meta).length ? ... : ""`).
- **Method:** `logger.info("plain message")`. `flush()`. Read the matching line from `app.log`.
- **Expected:** the line ends with `plain message ` (a trailing space from the format template) and contains no `{` / `}` / `{}`.

### LG-07 — exception and rejection handlers are configured
- **Purpose:** a crash is never silent (spec §1 "Crash handlers").
- **Method:** `require` the logger; inspect `logger.exceptions.handlers` and `logger.rejections.handlers` (Winston internal maps), and the transport filenames.
- **Expected:** there is at least one exception handler whose transport filename ends `exception.log`, and at least one rejection handler whose transport filename ends `rejection.log`.
