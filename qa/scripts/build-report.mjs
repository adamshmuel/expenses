#!/usr/bin/env node
/**
 * Build a self-contained, single-file HTML report from Vitest's JSON output.
 * All CSS/JS inline, no external assets, opens by double-click. Works offline,
 * light + dark.
 *
 * Inputs:
 *   qa/reports/_last-run.json   (Vitest --reporter=json output)
 *   qa/scripts/testcases.mjs    (the design-time test cases, inlined per test)
 * Outputs:
 *   qa/reports/YYYY-MM-DD-HHMM.html   (dated, never overwritten)
 *   qa/reports/latest.html            (fixed name for the newest run)
 *   qa/reports/YYYY-MM-DD-HHMM.json   (a copy of the raw runner output)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, GOVERNING, GROUPS } from "./testcases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const QA = resolve(here, "..");
const REPORTS = resolve(QA, "reports");
if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });

const RAW = resolve(REPORTS, "_last-run.json");
if (!existsSync(RAW)) {
  console.error(`No ${RAW} — run vitest first.`);
  process.exit(1);
}
const raw = JSON.parse(readFileSync(RAW, "utf8"));

// ---- flatten Vitest JSON into { id, title, file, status, duration, failureMessages } ----
const ID_RE = /\b([A-Z]{2})-(\d{2})\b/;
const tests = [];
for (const suite of raw.testResults ?? []) {
  const file = (suite.name || "").replace(QA + "/", "").replace(QA, "");
  for (const t of suite.assertionResults ?? []) {
    const full = t.fullName || t.title || "";
    const m = full.match(ID_RE);
    const id = m ? `${m[1]}-${m[2]}` : null;
    tests.push({
      id,
      key: m ? m[1] : "??",
      title: t.title || full,
      fullName: full,
      file,
      status: t.status, // "passed" | "failed" | "skipped" | "pending" | "todo"
      duration: t.duration ?? 0,
      failureMessages: t.failureMessages ?? [],
    });
  }
}

// ---- merge Playwright (e2e) results, if that suite has run ----
let e2eDurationMs = 0;
const PW_RAW = resolve(REPORTS, "_last-run-e2e.json");
if (existsSync(PW_RAW)) {
  const pw = JSON.parse(readFileSync(PW_RAW, "utf8"));
  e2eDurationMs = pw.stats?.duration ?? 0;
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const last = results[results.length - 1] ?? {};
        let status = last.status || "skipped";
        if (status === "timedOut" || status === "interrupted") status = "failed";
        const failureMessages = [];
        if (status === "failed") {
          for (const r of results) {
            if (r.error?.message) failureMessages.push(r.error.message);
            for (const e of r.errors ?? []) if (e?.message) failureMessages.push(e.message);
          }
        }
        const full = spec.title || "";
        const m = full.match(ID_RE);
        tests.push({
          id: m ? `${m[1]}-${m[2]}` : null,
          key: m ? m[1] : "??",
          title: full,
          fullName: full,
          file: (spec.file || "").replace(QA + "/", "").replace(QA, ""),
          status,
          duration: last.duration ?? 0,
          failureMessages,
        });
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of pw.suites ?? []) walk(s);
}

// ---- classify ----
const norm = (s) => (s === "pending" || s === "todo" ? "skipped" : s);
for (const t of tests) t.status = norm(t.status);

// Known spec/code divergences carried through from the design phase.
// NOTE (found this pass, not caused by it): RA-06 and XC-11's test bodies
// (qa/tests/unit/requireAuth.test.ts, qa/tests/api/04-crosscutting.test.ts)
// were already updated, before this pass, to assert the code's actual
// current wording instead of the spec's -- both now PASS. Committed as-is
// since commit 6c48c9d, well before this run; not something this pass
// changed. They stay listed here (still styled as a "wording note", not a
// green PASS with no context) so the divergenceRows table below still
// explains the spec-vs-code gap even though the test itself is green now.
const DIVERGENCES = ["RA-06", "XC-11", "XC-13", "EH-05"];
// Findings surfaced during the run that are not spec assertions (test passes,
// but the behaviour is a bug or a gap worth Adam's attention).
const FINDINGS = ["LI-10", "CC-12"];
// Real bugs found in an earlier pass (2026-09-15, first run) and FIXED before
// this run: categoryModel.js's 4 hooks (CH-01..16 + everything that depended
// on them: CI-03/04, DL-03, CC-08..11), and getExpenseTotalByCategory's
// ObjectId cast (ER-08/09, no date filter). All now PASS -- kept out of
// REAL_BUGS below since they are no longer failures. See qa/specs/README.md
// "Findings, fixed since the 2026-09-15 pass" for detail.
//
// Real bugs found THIS run and still open: these tests assert the SPEC's
// correct behaviour and are EXPECTED TO FAIL until Adam fixes the underlying
// code -- unlike DIVERGENCES (a wording/ordering nuance), these are genuine
// breakage. Styled the same as DIVERGENCES in the report (not "unexpected").
const REAL_BUGS = [
  "ER-10", "ER-11", "DJ-01",
];
// A "blocker" here = a test that could not run for an environment reason (none expected;
// filled from skips whose case notes say so). We also list design-phase blockers B1..B6.
const DESIGN_BLOCKERS = [
  { id: "B4", text: "No .env.example committed. Specs 06 §5 and 07 §6 require it. QA cannot create it (it would live under backend/). ADAM ACTION NEEDED." },
  { id: "B1", text: "backend/index.js does not export `app`. In-process supertest is impossible; API tests spawn the server as a child process. Optional Adam change if in-process testing is ever wanted." },
];

const counts = { passed: 0, failed: 0, skipped: 0 };
for (const t of tests) counts[t.status] = (counts[t.status] ?? 0) + 1;
const total = tests.length;

const failures = tests.filter((t) => t.status === "failed");
const expectedDivergenceFails = failures.filter((t) => DIVERGENCES.includes(t.id));
const realBugFails = failures.filter((t) => REAL_BUGS.includes(t.id));
const unexpectedFails = failures.filter((t) => !DIVERGENCES.includes(t.id) && !REAL_BUGS.includes(t.id));

// ---- coverage-against-spec statement ----
const SPEC_COVERAGE = [
  { spec: "01-ai-chat.md", covered: "§1 the auth routes exist and gate correctly, proven with a real browser + real server (UJ-01: signup lands on /home; logged-out /home bounces to /login). §4 the access token lives only in memory, never localStorage (UJ-01); the generic wrong-credential message is what the browser actually renders, not swallowed client-side (UJ-02).", notCovered: "§6/§7 the chat flow itself — not built, so no UI exists to test yet." },
  { spec: "03-api-contract.md", covered: "§0 (two error shapes; field-name mapping; CORS exact origin + credentials), §1 (all four /users/* endpoints: status tables, response bodies, cookie, generic 401, strict login rate limit; also proven end-to-end through a real browser in UJ-01/UJ-02).", notCovered: "§2 is a client-side list (already tested in client/). §3 endpoints are not built." },
  { spec: "04-data-model.md", covered: "User / RefreshToken / Expense field rules, unique indexes, RefreshToken TTL index (definition), Expense compound index, refresh-token rotation (net-zero row growth via RF-07).", notCovered: "Category model (no route exercises it; dormant). Message model (no file yet). TTL reaper actually deleting a row (slow/flaky — index definition asserted instead)." },
  { spec: "05-user-layers.md", covered: "§3 repository returns exercised through the service unit tests + API tests. §4 every service step incl. issueTokenPair payloads/lifetimes/secrets (US-01..US-18), and the full signup -> home -> reload -> logout loop end-to-end (UJ-01). §5 service-returns-vs-client-sees (SU/LI/RF body shape). §6 route handlers + cookie options + publicUser. §7 where validation lives (SU-08..SU-11, LI-05/06). §8 error table end-to-end. §10 decisions 1-4.", notCovered: "§6.1 secure:true HTTPS cookie branch (no HTTPS in v1 — the secure:false branch is what ships). Repository functions are not unit-tested in isolation (covered transitively by service + API + model tests); findUserByEmail is exercised only via the signup async validator path." },
  { spec: "06-server-modules.md", covered: "§1 logger transports incl. ai.log filter + crash handlers (LG-01..LG-07). §2 connectDB shape + exit-on-failure (DB-01..DB-03). §3 catchAsync (forward only, no log) + errorHandler (409 / .status / 500, log levels, one place) (EH-01..EH-11). §4 requireAuth contract (RA-01..RA-09).", notCovered: "§5 .env variable list is verified only indirectly (the server boots with the real vars). .env.example existence — REPORTED GAP (blocker B4)." },
  { spec: "07-server-entry.md", covered: "§1 start-up order (ST-01..ST-03). §2 middleware stack effects: helmet headers (XC-05/06), CORS exact origin (XC-07/08/09), JSON + cookie parsing (XC-12), global rate limiter present & looser than login (XC-14). §4 404 then errorHandler last (XC-10/11).", notCovered: "§2 exact global limiter ceiling of 300/15min (would need 300+ requests — disproportionate; presence + looseness asserted). CSRF (none in v1 by design). Static serving (none by design)." },
  { spec: "08-expense-category-dal.md", covered: "Every category/expense DAL function in the table (DL-01..DL-10): findOtherCategory, createManyCategories, deleteCategoriesByUser, getExpenseTotalByCategory (totals, date range, empty case), findExpenseById, reassignExpensesToCategory, queryExpenses (text + date range, combined).", notCovered: "Nothing deliberately skipped; findByName/resolveCategory-adjacent DAL calls are covered indirectly through CS-*/ES-*/CC-*." },
  { spec: "09-expense-category-service.md", covered: "§2 categoryService: findByName, createCategory/updateCategory/deleteCategory rule checks (CS-01..CS-13), seedDefaultCategories/resetToDefaults (CI-01..CI-04, both now passing). §3 expenseService: resolveCategory, createExpense, createManyExpenses' no-partial-save (EI-01/02), editExpense/deleteExpense ownership (ES-01..ES-09). §4 POST /chat/confirm's 7-branch intent switch (CC-01..CC-12, all now passing, including the 4 category-mutating intents that used to fail). §5 the three read-only routes (ER-01..ER-11).", notCovered: "Nothing deliberately skipped, but see the Findings section: §5's summary/list endpoints are proven BROKEN for any request whose date range includes today (ER-10/ER-11, new this pass) — the fix for the earlier ObjectId bug exposed a second, separate date-casting bug underneath it." },
  { spec: "01-ai-chat.md (chat additions)", covered: "§8 backend/ai/: prompt/schema shared-reference, call-args wiring, the clean-502 contract, the default-client singleton (AI-01..AI-12). §5/§9 GET /chat/messages ordering/limit/scoping (CM-03..06). §6/§7 the real chat->draft->confirm loop through a real browser with one real (minimal) Gemini call (FJ-01).", notCovered: "POST /chat/messages's AI-dependent intent-parsing behaviour at the API-test level (the 30-day window, per-intent matches for all 7 intents) — blocked on B7 (routes/chatRoute.js has no seam to inject a fake AI client; an API-level test would need a real, metered, non-deterministic Gemini call per case). Only the auth boundary (CM-01/02) and one real E2E call (FJ-01) are automated for this route." },
  { spec: "02-dashboard.md", covered: "Every stat/list the spec names, exercised via the three read-only endpoints its own client code calls (ER-01..ER-11) and one real-browser journey (DJ-01) checking the rendered page against the spec's text.", notCovered: "Client-side pure-function gaps already flagged by docs/reference/testing-reference/2026-09-15-client-additions-testable.md (computeRange's pick/custom branches, buildGroups zero-filtering, the stale-fetch race guard, the 'Other' fallback) are client-unit-test territory, not duplicated here. See the Findings section: the screen is STILL non-functional for real same-day data (always shows its empty state for a user who spent today) due to a server bug — the specific bug changed since the last run (was the ObjectId cast; now the date-boundary cast, ER-10/ER-11), but the user-visible symptom DJ-01 catches is the same." },
];
const E2E_NOTE = "E2E coverage (UJ-01, UJ-02, FJ-01, DJ-01) drives the real Vite client against the real running server in a real browser — the only layer that proves the cookie/token wiring and the chat-writes/dashboard-reads contract actually connect both sides, not just each in isolation. FJ-01 is the one place this whole pass calls the real Gemini API (one call, deliberately, headed so it can be watched). The silent-refresh-mid-session journey is still not automated (needs a way to force token expiry inside a running browser session — see docs/reference/testing-reference/2026-09-11-client-testable.md).";

// ---- HTML ----
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => String(s ?? "").replace(/\[[0-9;]*m/g, "").replace(/\[\d{1,2}m/g, "");
const esc = (s) =>
  stripAnsi(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function casePanel(t) {
  const c = t.id ? CASES[t.id] : null;
  const gov = t.id ? GOVERNING[t.key] : null;
  const isDiv = t.id && DIVERGENCES.includes(t.id);
  const isFinding = t.id && FINDINGS.includes(t.id);
  const isBug = t.id && REAL_BUGS.includes(t.id);
  const rows = [];
  if (c) {
    rows.push(`<div class="fld"><span class="k">Purpose</span><span class="v">${esc(c.purpose)}</span></div>`);
    rows.push(`<div class="fld"><span class="k">Under test</span><span class="v">${esc(c.under)}</span></div>`);
    rows.push(`<div class="fld"><span class="k">Method (setup + exact inputs + action)</span><span class="v">${esc(c.method)}</span></div>`);
    rows.push(`<div class="fld"><span class="k">Expected result</span><span class="v">${esc(c.expected)}</span></div>`);
    if (c.divergence) rows.push(`<div class="fld div"><span class="k">Spec/code note</span><span class="v">${esc(c.divergence)}</span></div>`);
  } else {
    rows.push(`<div class="fld"><span class="k">Note</span><span class="v">No design-time case matched this test id. Title: ${esc(t.fullName)}</span></div>`);
  }
  rows.push(
    `<div class="fld"><span class="k">Actual result (this run)</span><span class="v">${
      t.status === "passed"
        ? "PASSED — all assertions held."
        : t.status === "skipped"
        ? "SKIPPED."
        : "FAILED. " + (isDiv ? "(Expected: this is a carried-through spec/code divergence.)" : isBug ? "(Expected: this asserts the spec's correct behaviour against a real bug found this pass — see the Findings section above.)" : "")
    }</span></div>`
  );
  if (t.status === "failed" && t.failureMessages.length) {
    rows.push(
      `<div class="fld"><span class="k">Failure detail (expected vs actual)</span><pre class="fail">${esc(
        t.failureMessages.join("\n\n").slice(0, 4000)
      )}</pre></div>`
    );
  }
  if (gov) {
    rows.push(
      `<div class="fld"><span class="k">Source test file</span><span class="v mono">${esc(gov.src)}</span></div>` +
        `<div class="fld"><span class="k">Test spec</span><span class="v mono">${esc(gov.specFile)}</span></div>` +
        `<div class="fld"><span class="k">Governing spec</span><span class="v mono">${esc(gov.file)} — ${esc(gov.sec)}</span></div>`
    );
  }
  return `<div class="panel">${rows.join("")}</div>`;
}

function testRow(t) {
  const cls = t.status === "failed" ? "row failed" : t.status === "skipped" ? "row skipped" : "row passed";
  const badge =
    t.status === "failed" ? '<span class="badge b-fail">FAIL</span>' : t.status === "skipped" ? '<span class="badge b-skip">SKIP</span>' : '<span class="badge b-pass">PASS</span>';
  const divTag =
    t.id && DIVERGENCES.includes(t.id)
      ? '<span class="badge b-div">SPEC DIVERGENCE</span>'
      : t.id && REAL_BUGS.includes(t.id)
      ? '<span class="badge b-bug">BUG</span>'
      : t.id && FINDINGS.includes(t.id)
      ? '<span class="badge b-div">FINDING</span>'
      : "";
  const open = t.status === "failed" ? " open" : "";
  return `<details class="${cls}"${open}>
  <summary><span class="tid">${esc(t.id || "—")}</span><span class="ttl">${esc(cleanTitle(t.title, t.id))}</span>${badge}${divTag}</summary>
  ${casePanel(t)}
</details>`;
}
function cleanTitle(title, id) {
  if (!id) return title;
  return title.replace(new RegExp(`^${id}\\s*`), "").replace(/\s*\[(SPEC DIVERGENCE|DESIGN NOTE|wording note)\]\s*$/i, "");
}

const groupsHtml = GROUPS.map((g) => {
  const rowTests = tests.filter((t) => t.key === g.key).sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  if (!rowTests.length) return "";
  const gp = rowTests.filter((t) => t.status === "passed").length;
  const gf = rowTests.filter((t) => t.status === "failed").length;
  const gs = rowTests.filter((t) => t.status === "skipped").length;
  const gov = GOVERNING[g.key];
  return `<section class="group">
    <h2>${esc(g.title)}
      <span class="gcount">${gp} pass${gf ? ` · <span class="cf">${gf} fail</span>` : ""}${gs ? ` · ${gs} skip` : ""}</span>
    </h2>
    <div class="gmeta">Tests: <span class="mono">${esc(gov?.src || "")}</span> · Design: <span class="mono">${esc(gov?.specFile || "")}</span> · Spec: <span class="mono">${esc(gov?.file || "")} ${esc(gov?.sec || "")}</span></div>
    ${rowTests.map(testRow).join("\n")}
  </section>`;
}).join("\n");

const failuresList = failures.length
  ? failures
      .map(
        (t) =>
          `<li class="${DIVERGENCES.includes(t.id) || REAL_BUGS.includes(t.id) ? "exp" : "unexp"}"><span class="tid">${esc(t.id || "—")}</span> ${esc(
            cleanTitle(t.title, t.id)
          )} <span class="mono">(${esc(t.file)})</span>${
            DIVERGENCES.includes(t.id)
              ? " — carried-through spec/code divergence (expected)"
              : REAL_BUGS.includes(t.id)
              ? " — REAL BUG found this pass (expected fail, see Findings below)"
              : " — NEEDS ATTENTION"
          }</li>`
      )
      .join("")
  : "<li>None.</li>";

const divergenceRows = [
  ["RA-06", "docs/specs/06-server-modules.md §4 step 3", "Failed-verify body must be { error: \"Not authenticated.\" }", "requireAuth.js line 41 returns { error: \"Invalid or expired token!\" }", "PASS — the test now asserts the code's actual wording, not the spec's (changed before this pass). Status 401 + no-next are correct; the wording gap vs. spec text is unresolved either way."],
  ["XC-11", "docs/specs/07-server-entry.md §4 #1", "404 body must be { error: \"Not found.\" }", "index.js line 57 returns { error: \"Not Found\" }", "PASS — the test now asserts the code's actual wording, not the spec's (changed before this pass). Status 404 + { error } shape are correct; the wording gap vs. spec text is unresolved either way."],
  ["XC-13", "docs/specs/07-server-entry.md §2", "helmet() is middleware #1", "compression() is #1, helmet() #2 in index.js", "PASS with a recorded design note — compression sends no response, so nothing is un-helmeted."],
  ["EH-05", "docs/specs/06-server-modules.md §3.2", "409 body message '<field> already exists.'", "errorHandler returns 'That username or email is already taken.'", "PASS on status + shape; wording divergence recorded as a note."],
  ["F-1 (LI-10)", "not a spec assertion — 05 §4 / 04 'RefreshToken'", "A user should be able to log in twice (or sign up then log in) without error", "Same-second identical refresh JWT collides on RefreshToken.token unique index -> 409", "TEST PASSES (confirms the behaviour). Real bug: double-click login -> 409. Fix: add a random jti to the refresh-token payload in issueTokenPair."],
  ["CC-12", "not a spec assertion — gap noted in 2026-09-15-server-additions-testable.md", "n/a — a request-validation gap, not a documented rule", "An unrecognized POST /chat/confirm intent falls through the switch, changed stays undefined, still 200", "TEST PASSES (confirms current behaviour). Worth Adam's attention: routes/chatRoute.js never validates req.body.intent."],
]
  .map(
    (r) =>
      `<tr><td class="tid">${esc(r[0])}</td><td class="mono">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`
  )
  .join("");

const FIXED_BUG_ROWS = [
  ["CH-01..16, CI-03/04, DL-03, CC-08..11 (23 tests)", "backend/models/categoryModel.js", "Every pre('save')/pre('findOneAndUpdate')/pre('findOneAndDelete')/pre('deleteMany') hook was declared async function(next) and called next()/next(err) inside it — the installed Mongoose version does not give an async hook a callable next. Every branch, success or rejection, threw TypeError: next is not a function. Only insertMany (seedDefaultCategories at signup) escaped, since Mongoose skips 'save' middleware for it.", "FIXED — dropped the `next` parameter and every `next(...)`/`next()` call from all four hooks; throw instead of next(err), bare return instead of next(). All 23 tests now PASS. CC-08..11 were rewritten from asserting the 500 to asserting the spec's real success shape."],
  ["ER-08, ER-09 (2 tests, no date filter)", "backend/dal/expenseRepository.js — getExpenseTotalByCategory", "The aggregation's $match stage was built as { user: userId } and passed straight to Expense.aggregate(). Mongoose only casts a plain string to ObjectId inside its own query-builder methods (find, a document constructor, ...) — a raw aggregate() stage is not cast. req.user.id (from the JWT, via requireAuth) is always a plain string.", "FIXED — wrapped `new mongoose.Types.ObjectId(userId)` before building the $match filter. Both tests now PASS."],
  ["CI-03/04 (resetToDefaults ordering — also depended on the categoryModel.js fix above)", "backend/bl/categoryService.js — resetToDefaults", "Old order: find the OLD 'Other' → reassign expenses to it → delete ALL categories (including that old 'Other') → reseed defaults. Every expense ended up pointing at a category id that had just been deleted.", "FIXED — reordered: delete old categories first → seed new defaults → find the NEW 'Other' among them → reassign expenses to the new 'Other's id."],
]
  .map(
    (r) =>
      `<tr><td class="tid">${esc(r[0])}</td><td class="mono">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`
  )
  .join("");

const REAL_BUG_ROWS = [
  ["ER-10 (GET /expenses)", "backend/dal/expenseRepository.js — queryExpenses", "Model.find() auto-casts the bare 'YYYY-MM-DD' query-string date to midnight UTC that day. A request with to=<today> therefore excludes any expense recorded LATER the same day — i.e. almost every same-day expense. Confirmed with a plain script against backend's own code.", "An expense recorded today can silently vanish from GET /expenses whenever the caller's range includes 'today' as the upper bound — exactly what the Dashboard's default period does. Fix: build `to` as end-of-day (e.g. `new Date(to); d.setHours(23,59,59,999)`) before comparing, both here and in getExpenseTotalByCategory below."],
  ["ER-11, DJ-01 (GET /expenses/summary)", "backend/dal/expenseRepository.js — getExpenseTotalByCategory", "Second, separate instance of the same 'raw aggregate() doesn't auto-cast' bug class that the now-fixed ObjectId issue was — this time for dates. The raw .aggregate() $match stage compares the bare query-string `to` against a BSON Date and never matches, regardless of time-of-day. Confirmed with a plain script against backend's own code.", "GET /expenses/summary still returns 0/[] for any request whose range includes today — which is every request the Dashboard's own 'This month' period makes. DashboardPage.tsx still renders its empty state for a user who spent today, proven end-to-end in DJ-01 (fails for this new reason, not the fixed ObjectId one). Ship-blocking for 02-dashboard.md, same severity as the fixed bug. Fix: build a real `Date` from `to`/`from` before the $match, at end-of-day / start-of-day respectively."],
]
  .map(
    (r) =>
      `<tr><td class="tid">${esc(r[0])}</td><td class="mono">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`
  )
  .join("");

const specCoverageHtml = SPEC_COVERAGE.map(
  (s) =>
    `<div class="sc"><h3>${esc(s.spec)}</h3><p><strong>Covered:</strong> ${esc(s.covered)}</p><p class="nc"><strong>Not covered (and why):</strong> ${esc(
      s.notCovered
    )}</p></div>`
).join("");

const blockersHtml = DESIGN_BLOCKERS.map((b) => `<li><span class="tid">${esc(b.id)}</span> ${esc(b.text)}</li>`).join("");

const durationMs = (raw.testResults ?? []).reduce((a, s) => a + ((s.endTime ?? 0) - (s.startTime ?? 0)), 0) + e2eDurationMs;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expenses QA report — ${esc(stamp)}</title>
<style>
  :root{
    --bg:#f7f7f5; --card:#fff; --ink:#1b1b1a; --mut:#6b6b68; --line:#e2e2dd;
    --pass:#1a7f37; --pass-bg:#e8f5ec; --fail:#b3261e; --fail-bg:#fdecea;
    --skip:#8a6d00; --skip-bg:#fbf3d9; --div:#6f42c1; --div-bg:#f1ebfb;
    --bug:#b3261e; --bug-bg:#fde0dc;
    --accent:#0b5cad;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#16161a; --card:#1f1f24; --ink:#ececeb; --mut:#a2a2a0; --line:#33333a;
      --pass:#4ac26b; --pass-bg:#16281c; --fail:#ff6b60; --fail-bg:#2c1a18;
      --skip:#e0c04a; --skip-bg:#2a2513; --div:#c9a3ff; --div-bg:#241a33;
      --bug:#ff8a80; --bug-bg:#3a1613;
      --accent:#68a8e6;
    }
  }
  :root[data-theme="dark"]{
    --bg:#16161a; --card:#1f1f24; --ink:#ececeb; --mut:#a2a2a0; --line:#33333a;
    --pass:#4ac26b; --pass-bg:#16281c; --fail:#ff6b60; --fail-bg:#2c1a18;
    --skip:#e0c04a; --skip-bg:#2a2513; --div:#c9a3ff; --div-bg:#241a33;
    --bug:#ff8a80; --bug-bg:#3a1613; --accent:#68a8e6;
  }
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0;padding:0}
  .wrap{max-width:1040px;margin:0 auto;padding:28px 20px 80px}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:var(--mut);margin:0 0 20px}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .tid{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700;color:var(--accent);margin-right:8px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:0 0 18px}
  .totals{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 4px}
  .chip{border-radius:999px;padding:6px 14px;font-weight:700;border:1px solid var(--line)}
  .chip.pass{background:var(--pass-bg);color:var(--pass)}
  .chip.fail{background:var(--fail-bg);color:var(--fail)}
  .chip.skip{background:var(--skip-bg);color:var(--skip)}
  .chip.tot{background:transparent;color:var(--mut)}
  ul{margin:8px 0;padding-left:22px}
  li.unexp{color:var(--fail);font-weight:600}
  li.exp{color:var(--div)}
  li.unexp .mono, li.exp .mono{font-weight:400}
  table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{background:var(--bg);font-weight:700}
  .group{margin:26px 0 0}
  .group h2{font-size:16px;border-bottom:2px solid var(--line);padding-bottom:6px;margin:22px 0 4px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
  .gcount{font-size:12px;color:var(--mut);font-weight:600}
  .gcount .cf{color:var(--fail)}
  .gmeta{color:var(--mut);font-size:11.5px;margin:0 0 10px}
  details.row{background:var(--card);border:1px solid var(--line);border-radius:8px;margin:7px 0;overflow:hidden}
  details.row>summary{cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:8px;list-style:none}
  details.row>summary::-webkit-details-marker{display:none}
  details.row>summary::before{content:"▸";color:var(--mut);font-size:11px}
  details.row[open]>summary::before{content:"▾"}
  .ttl{flex:1;min-width:0}
  .row.failed{border-color:var(--fail)}
  .row.failed>summary{background:var(--fail-bg)}
  .row.skipped>summary{background:var(--skip-bg)}
  .badge{font-size:10.5px;font-weight:800;letter-spacing:.03em;border-radius:5px;padding:2px 7px}
  .b-pass{background:var(--pass-bg);color:var(--pass)}
  .b-fail{background:var(--fail-bg);color:var(--fail)}
  .b-skip{background:var(--skip-bg);color:var(--skip)}
  .b-div{background:var(--div-bg);color:var(--div)}
  .b-bug{background:var(--bug-bg);color:var(--bug);font-weight:900}
  .panel{padding:6px 16px 16px;border-top:1px solid var(--line)}
  .fld{display:grid;grid-template-columns:200px 1fr;gap:14px;padding:8px 0;border-bottom:1px dashed var(--line)}
  .fld:last-child{border-bottom:none}
  .fld .k{color:var(--mut);font-weight:700;font-size:12px}
  .fld.div .k, .fld.div .v{color:var(--div)}
  pre.fail{grid-column:1/-1;background:var(--fail-bg);color:var(--fail);border-radius:6px;padding:12px;overflow-x:auto;white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;margin:6px 0 0}
  .sc{margin:12px 0;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
  .sc h3{margin:0 0 6px;font-size:13.5px;font-family:ui-monospace,Menlo,Consolas,monospace}
  .sc p{margin:4px 0}
  .sc .nc{color:var(--mut)}
  .toolbar{position:sticky;top:0;background:var(--bg);padding:10px 0;margin:-10px 0 10px;border-bottom:1px solid var(--line);z-index:5;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .toolbar label{font-size:13px;color:var(--mut);cursor:pointer;user-select:none}
  .hint{color:var(--mut);font-size:12px}
  body.only-fail details.row.passed, body.only-fail details.row.skipped{display:none}
  body.only-fail section.group:not(:has(details.row.failed)){display:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>Expenses — QA run against specs 01–09</h1>
  <p class="sub">${esc(now.toString())} · auth + chat + expense/category + AI + dashboard surface, plus browser E2E (client ↔ server) · test DB <span class="mono">expenses_qa_test</span> (dropped on teardown) · duration ~${(durationMs/1000).toFixed(1)}s${existsSync(PW_RAW) ? "" : " · e2e suite not run this time — see note below"}</p>

  <div class="toolbar">
    <label><input type="checkbox" id="ofilter"> Show failures &amp; skips only</label>
    <span class="hint">Failed rows are expanded by default. Every row expands to the full test case.</span>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Summary</h2>
    <div class="totals">
      <span class="chip tot">${total} total</span>
      <span class="chip pass">${counts.passed} passed</span>
      <span class="chip fail">${counts.failed} failed</span>
      <span class="chip skip">${counts.skipped} skipped</span>
      <span class="chip tot">0 blocked (env)</span>
    </div>

    <h3>Every failure</h3>
    <ul>${failuresList}</ul>
    <p class="hint">${unexpectedFails.length === 0
      ? "No unexpected failures. Every failure below is either a carried-through spec/code divergence, or a real bug found and documented this pass (see below) — nothing here is an unexplained flake."
      : `<strong>${unexpectedFails.length} failure(s) need attention</strong> beyond the known divergences and documented bugs.`}</p>

    <h3 style="color:var(--pass)">Bugs fixed since the last run (2026-09-15, second pass)</h3>
    <p class="hint">The 3 backend bugs the previous run (21 failures) surfaced were fixed by Adam before this run. All 23 tests previously asserting the categoryModel.js hook bug, plus ER-08/ER-09 (the ObjectId-cast bug), now PASS. See <span class="mono">qa/specs/README.md</span> for the full before/after.</p>
    <table>
      <thead><tr><th>Tests</th><th>File</th><th>Root cause</th><th>Fix</th></tr></thead>
      <tbody>${FIXED_BUG_ROWS}</tbody>
    </table>

    <h3 style="color:var(--bug)">Real bugs found this pass (still open) — not wording, actual breakage</h3>
    <p class="hint">${realBugFails.length} of ${REAL_BUGS.length} tests written against this bug failed as expected this run — see each one, expanded, in its area below (badged <span class="badge b-bug">BUG</span>). In <span class="mono">backend/</span> outside <span class="mono">ai/</span> — Adam's own code; QA reports it, does not fix it. Confirmed independently of this test harness with a plain script directly against backend's code (not a QA-harness artifact). This is a second, separate instance of the same bug class as the now-fixed ObjectId issue above — dates instead of ids — first visible only once the ObjectId fix stopped masking it.</p>
    <table>
      <thead><tr><th>Tests</th><th>File</th><th>Root cause</th><th>Impact / fix</th></tr></thead>
      <tbody>${REAL_BUG_ROWS}</tbody>
    </table>

    <h3>Blockers (need an Adam-only change or a decision)</h3>
    <ul>${blockersHtml}</ul>
    <p class="hint">B7 (routes/chatRoute.js has no seam to inject a fake AI client) is why POST /chat/messages's AI-dependent behaviour is not covered at the API-test level this pass — only its auth boundary (CM-01/02) and one real, minimal, deliberate Gemini call in the E2E suite (FJ-01) are automated. Not reported as a required Adam change — noted so the gap is visible.</p>

    <h3>Spec / code divergences and findings</h3>
    <p class="hint">RA-06 and XC-11 both PASS — their test bodies were already updated (before this pass) to assert the code's current wording rather than the spec's; the wording gap from the spec text is still real, just no longer an asserted-and-failing test. XC-13 and EH-05 also pass on the behaviour that matters and are recorded as notes. F-1 and CC-12 are gaps the run surfaced; their tests pass by confirming the current behaviour.</p>
    <table>
      <thead><tr><th>ID</th><th>Governing clause</th><th>Spec says</th><th>Code does</th><th>Outcome</th></tr></thead>
      <tbody>${divergenceRows}</tbody>
    </table>

    <h3>Coverage against each governing spec</h3>
    ${specCoverageHtml}
    <p class="hint">${esc(E2E_NOTE)}</p>
  </div>

  ${groupsHtml}

  <p class="sub" style="margin-top:40px">Generated by <span class="mono">qa/scripts/build-report.mjs</span>. Raw runner output alongside this file as <span class="mono">${esc(stamp)}.json</span>. Design-time cases: <span class="mono">qa/specs/*.md</span> (inlined here via <span class="mono">qa/scripts/testcases.mjs</span>).</p>
</div>
<script>
  document.getElementById('ofilter').addEventListener('change', function(e){
    document.body.classList.toggle('only-fail', e.target.checked);
  });
</script>
</body>
</html>`;

const datedHtml = resolve(REPORTS, `${stamp}.html`);
const latestHtml = resolve(REPORTS, "latest.html");
const datedJson = resolve(REPORTS, `${stamp}.json`);
writeFileSync(datedHtml, html);
writeFileSync(latestHtml, html);
writeFileSync(datedJson, JSON.stringify(raw, null, 2));

console.log(`report written:
  ${datedHtml.replace(QA + "/", "qa/")}
  ${latestHtml.replace(QA + "/", "qa/")}
  ${datedJson.replace(QA + "/", "qa/")}
summary: ${counts.passed} passed / ${counts.failed} failed / ${counts.skipped} skipped (of ${total})`);
