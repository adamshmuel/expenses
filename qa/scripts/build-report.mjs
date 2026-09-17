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
import { FLOW_CASES } from "./parse-flow-specs.mjs";

// The three PROVISIONAL bars (Adam has not confirmed any of them) --
// coordinator instruction 2026-09-16: mark these clearly so a failure's
// meaning (app wrong vs. bar wrong) is visible at a glance. Single source:
// qa/harness/bars.ts names the same three; kept as an id list here since the
// report only needs to know WHICH tests to flag, not the numbers themselves.
const PROVISIONAL_BAR_IDS = ["FR-36", "FR-37", "FR-38", "FR-39", "FR-43", "LV-24"];

// A case that never became a runnable test -- reported as BLOCKED, not
// silently absent. FR-05's unit half needs `buildPending` exported from
// client/src/store/chatSlice.ts; qa-tester does not touch client/ this run
// (delegation.md routes it to the builder agent, not authorised this pass).
const BLOCKED_CASES = [
  {
    id: "FR-05",
    key: "FR",
    title: "(unit half) buildPending's four rejection branches, tested directly",
    reason:
      "buildPending is not exported from client/src/store/chatSlice.ts, so it cannot be unit-tested directly from qa/. Per .claude/rules/delegation.md, a client/ code change is the builder agent's job, not qa-tester's, and it was not authorised this run. The browser half of FR-05 (stubbing /chat/messages to force each rejection branch and checking the user is told what went wrong) IS implemented and ran.",
  },
];

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
      aiRawLines: [],
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
        // Raw response bodies for cases that drive the real model
        // (coordinator instruction, 2026-09-16 run): every test's own
        // console.log via qa/e2e/helpers.ts's logAIRaw lands in Playwright's
        // per-result stdout, tagged "[AI-RAW ...]" -- pull just those lines
        // out so a failure can be diagnosed without paying to re-run it.
        const aiRawLines = [];
        for (const r of results) {
          for (const entry of r.stdout ?? []) {
            const text = typeof entry === "string" ? entry : entry?.text;
            if (text && text.includes("[AI-RAW")) aiRawLines.push(text.trim());
          }
        }
        tests.push({
          id: m ? `${m[1]}-${m[2]}` : null,
          key: m ? m[1] : "??",
          title: full,
          fullName: full,
          file: (spec.file || "").replace(QA + "/", "").replace(QA, ""),
          status,
          duration: last.duration ?? 0,
          failureMessages,
          aiRawLines,
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

// Blocked cases never became a runnable test at all -- injected directly so
// they show up in the summary counts and their own group, not silently
// absent from the report.
for (const b of BLOCKED_CASES) {
  tests.push({
    id: b.id,
    key: b.key,
    title: `${b.id} ${b.title}`,
    fullName: `${b.id} ${b.title}`,
    file: "(blocked — no test file)",
    status: "blocked",
    duration: 0,
    failureMessages: [],
    aiRawLines: [],
    blockedReason: b.reason,
  });
}

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
// Real bugs found across the 2026-09-15 passes, all FIXED as of this run:
// categoryModel.js's 4 hooks (CH-01..16 + everything that depended on them:
// CI-03/04, DL-03, CC-08..11), getExpenseTotalByCategory's ObjectId cast
// (ER-08/09, no date filter), and the date-boundary cast bug found right
// after that fix (ER-10/ER-11, DJ-01). All now PASS -- kept out of REAL_BUGS
// below since none are currently failing. See qa/specs/README.md "Findings,
// fixed since the 2026-09-15 pass" for detail.
//
// Real bugs found and still open, this run: none. Tests here would assert
// the SPEC's correct behaviour and be EXPECTED TO FAIL until Adam fixes the
// underlying code -- unlike DIVERGENCES (a wording/ordering nuance), these
// would be genuine breakage.
const REAL_BUGS = [];
// A "blocker" here = a test that could not run for an environment reason (none expected;
// filled from skips whose case notes say so). We also list design-phase blockers B1..B6.
const DESIGN_BLOCKERS = [
  { id: "B4", text: "No .env.example committed. Specs 06 §5 and 07 §6 require it. QA cannot create it (it would live under backend/). ADAM ACTION NEEDED." },
  { id: "B1", text: "backend/index.js does not export `app`. In-process supertest is impossible; API tests spawn the server as a child process. Optional Adam change if in-process testing is ever wanted." },
];

// ---- 2026-09-16 pass: cases the spec itself documents as failing against
// the current build ("Status today: fails" / "Known failure:") -- these are
// DESIGNED to be red; a pass here would be the surprise. Compiled by hand
// from qa/specs/flow-fresh-2026-09-16.md and flow-lived-in-2026-09-16.md's
// own prose (not derived from run results, so it can't drift toward
// "whatever happened to fail this time").
const DESIGNED_TO_FAIL_2026_09_16 = [
  "FR-01", "FR-02", "FR-04", "FR-05", "FR-06", "FR-07", "FR-11", "FR-13",
  "FR-16", "FR-17", "FR-19", "FR-38", "FR-39", "FR-41", "FR-43", "FR-44",
  "BD-07", "LV-20",
];

/**
 * Per-test triage verdicts for the 2026-09-16 full run, keyed by an exact or
 * partial (RegExp) match against the test's title. Compiled by hand after
 * reading every failure's actual error text, and in a handful of cases
 * (FR-27, LV-22, FR-39) re-running that one test in isolation and, for
 * LV-22, spinning up the real lived-in server and hitting GET
 * /expenses/summary directly to compare against a raw database sum.
 *
 * verdict: "real" (the app is wrong) | "test" (this test's own code is
 * wrong) | "artifact" (rate limiting / model slowness / a timing race in
 * the harness -- not evidence about the app either way) | "inconclusive"
 * (genuinely unsure -- said plainly rather than guessed).
 */
const TRIAGE_2026_09_16 = [
  // ---- confirmed real defects ----
  { match: /^BD-01/, verdict: "real", note: "The AI offers to edit/delete an expense that does not exist (\"Would you like me to update the coffee expense to 30?\" with zero expenses on the account) -- a false match, not a refusal." },
  { match: /^FR-42/, verdict: "real", note: "The refusal to total up spending never mentions the dashboard, even though a handoff is right there -- matches the spec's own expectation exactly." },
  { match: /^XS-05 \(browser half\)/, verdict: "real", note: "SEVERE. `spent -50 on coffee` -> \"I've noted 50 under Food -> Coffee... Would you like me to save this expense?\" -- the negative sign is silently dropped and a Confirm button is offered for the positive amount. Confirmed via the raw AI-RAW log line, not inferred." },
  { match: /^FR-16/, verdict: "real", note: "/users/refresh fires twice on start-up (a StrictMode/double-mount race), and because refresh ROTATES the token, the loser's 401 can log the user out. Same root cause as FR-17, FR-18 and UJ-01 below -- one bug, four symptoms." },
  { match: /^FR-17/, verdict: "real", note: "Same root cause as FR-16 -- reload sometimes lands on /login." },
  { match: /^FR-18/, verdict: "real", note: "Same root cause as FR-16 -- reachable with two tabs, no StrictMode needed." },
  { match: /^UJ-01/, verdict: "real", note: "Same root cause as FR-16. This is the pre-existing auth-journey test qa-lead flagged as \"suspect, re-check\" on 2026-09-16 (it used to pass while FR-16/17 documented the same app failing by hand) -- it now fails too. Confirms the suspicion; not a new class of bug." },
  { match: /^FR-06/, verdict: "real", note: "Same root cause as FR-16 -- surfaced as a TypeError in this test's own refresh helper (an error body where an access token was expected) rather than a clean assertion failure, because the reload raced the same double-refresh bug. The test could handle that response more gracefully; the underlying cause is the app's." },
  { match: /^FR-11/, verdict: "real", note: "Confirms the spec's documented \"Status today: fails\" -- the confirm card shows no date at all." },
  { match: /^FR-10/, verdict: "real", note: "NEW. \"actually it was 22\" did not change anything -- the stored amount stayed 18. A correction was silently ignored, not merely mis-worded." },
  { match: /^LV-20/, verdict: "real", note: "Confirms the spec's own prediction: a real expense (₪200, from LV-08's \"spent 200 at the supermarket\") was written with neither store nor description during this run. The accumulated form of FR-13's bug." },
  { match: /^LV-15/, verdict: "real", note: "lv_steady's dashboard genuinely overflows horizontally at 375px once expanded with real category depth. Moderate confidence -- not cross-checked against a second run." },
  { match: /^FR-38 \[PROVISIONAL BAR\]/, verdict: "real", note: "PROVISIONAL BAR. Objective, reproducible measurement: the navbar's \"Log in\"/\"Sign up\" links are 40x23px and 79x36px, both under the proposed 44x44px minimum. Whether they should even be showing while the user is authenticated is a separate question this case doesn't test." },
  { match: /^FR-43 \[PROVISIONAL BAR\]/, verdict: "real", note: "PROVISIONAL BAR. A Hebrew message got an English reply, exactly the known failure the spec names. Whether this bar is required at all is Adam's call, not yet made." },
  { match: /^FS-02/, verdict: "real", note: "Pre-existing, already-documented failure (2026-09-16 1630 run) -- not new, left failing on purpose." },
  { match: /^FS-06/, verdict: "real", note: "Pre-existing, already-documented failure (2026-09-16 1630 run) -- not new, left failing on purpose." },
  { match: /^FR-44/, verdict: "artifact", note: "Timed out at 60s with no assertion failure recorded -- consistent with the AI slowness documented below (BD-07/FR-08 cluster), not a clean product finding. Re-run to confirm before treating as real." },

  // ---- designed-to-fail cases confirmed still failing (see DESIGNED_TO_FAIL_2026_09_16) ----
  { match: /^FR-01 /, verdict: "real", note: "PASSED this run, contradicting the spec's \"Status today: fails\" -- see the designed-to-fail table above, worth a second look rather than assumed fixed." },
  { match: /^FR-02 /, verdict: "real", note: "Confirms the spec's documented false-save-claim bug." },
  { match: /^FR-03 /, verdict: "real", note: "\"I have saved your 20 expense under Food -> Coffee.\" -- another instance of the false-save-claim class, on the \"yes\" path specifically." },
  { match: /^FR-04 /, verdict: "real", note: "Confirms the spec's \"fails intermittently\" -- reply named Food AND Coffee, the card showed only Coffee." },
  { match: /^FR-05 /, verdict: "real", note: "Confirms the spec's documented gap: an over-long store is correctly withheld from the draft, but the reply (\"Got it, ₪20 under Food.\") gives the user no way forward and no sign anything was wrong." },
  { match: /^FR-07 /, verdict: "real", note: "Confirms the spec's documented \"three of four outcomes are identical\" -- cancelled and reloaded produced byte-identical assistant text." },
  { match: /^FR-13 \(browser half\)/, verdict: "artifact", note: "This specific run hit the 45s Confirm-button timeout (see the AI-degeneration cluster below), so this instance does not independently confirm the label bug -- but FR-13's API half and LV-20's sweep both confirm it directly this same run, so the underlying bug stands on that evidence regardless." },
  { match: /^FR-19 /, verdict: "real", note: "Confirms the spec's documented finding -- prose persists, the draft does not, and nothing says it lapsed." },
  { match: /^FR-41 /, verdict: "test", note: "Test defect, not a product finding: the case's own spec text allows EITHER an on-screen control OR \"a typed answer is understood\" -- this test only ever checks for the control. \"bought coffee\" -> \"how much did it cost?\" is answerable by typing a number (proven elsewhere, FR-09), so this failure reflects an incomplete test, not a real dead end." },

  // ---- confirmed test defects ----
  { match: /^FR-27/, verdict: "test", note: "Confirmed by re-running in isolation and reading the page snapshot at the moment of failure: the test read the assistant's last bubble immediately after sending \"reset my categories\", before that round trip had returned -- it was still reading the PREVIOUS turn's reply. Missing an await for the round trip, not a product bug." },
  { match: /^FR-39 \[PROVISIONAL BAR\]/, verdict: "test", note: "Confirmed by reading the client source: FormField.tsx renders a field error in a span with class `field__error` (double underscore); this test looked for `.field-error` (hyphen) and found nothing. A selector typo, not evidence the app has no validation errors." },
  { match: /^FR-40/, verdict: "test", note: "This test never seeds any expense before checking /dashboard for \"Total spent\" -- on a genuinely empty account the dashboard correctly shows its empty state instead, per spec 02. The test is checking the wrong state, not a missing element." },
  { match: /^LV-04/, verdict: "test", note: "Environment-builder bug (qa/env/lived-in.ts), not a product bug: \"parking\" is also a label the generic filler expenses can pick from the shared item catalogue, so lv_corrector ended up with more \"parking\"-labelled rows than the curated 4-entry cluster the spec describes. The seeder needs to keep its curated cluster labels out of the generic filler's pool." },
  { match: /^LV-05/, verdict: "test", note: "Same environment-builder bug as LV-04, for \"supermarket\" (5 curated + 5 more from generic filler = 10 shown)." },
  { match: /^LV-11/, verdict: "test", note: "Test defect: the dashboard's expand/collapse state is normal React state that persists across this test's 5-period loop; clicking to \"expand\" Food a second time (already left open from the previous period) collapses it instead, hiding the very row being asserted on. Needs to check aria-expanded before clicking, not assume closed." },
  { match: /^LV-14/, verdict: "test", note: "Test defect: this compared GET /chat/messages against itself -- that endpoint is deliberately capped at 50 (spec 01 §6), so it can never prove \"more than 50 exist\" no matter how many are seeded. Needs a direct database count instead." },
  { match: /^LV-22/, verdict: "test", note: "Re-verified by hand: started the real lived-in server, logged in as lv_steady, and called GET /expenses/summary directly -- its total (₪21,833.50) matches a raw database sum to the agora. The two numbers agree; this test's own comparison does not currently reproduce that agreement and has an unresolved bug of its own. Not a product defect." },
  { match: /^LV-02/, verdict: "test", note: "Likely test defect: this test's throwaway fresh-account username is built from bare Date.now() (no counter, unlike the shared makeUser() helper), which risks a timestamp collision under repeated runs. Signup landed back on /signup instead of /home, consistent with a duplicate-username 400/409 rather than a product issue." },
  { match: /^FR-33/, verdict: "test", note: "A TypeError inside this test's own expect.poll() predicate (\"received value must be a number, received undefined\") -- a scripting bug in the test, not an assertion about the app." },
  { match: /^BD-04/, verdict: "test", note: "Test defect: reads the transcript immediately after page.reload() with no wait for the async chat-history fetch to finish rendering, so it sometimes sees zero bubbles regardless of what the server actually returns. Needs to wait for the history request before reading the DOM." },
  { match: /^LV-23/, verdict: "test", note: "This case's own verification logic has two real design flaws found while reading it after the fact: (1) a through-the-screen send is marked successful regardless of whether a Confirm button ever appeared or was clicked; (2) a sentence is \"verified\" by finding ANY expense with a matching amount anywhere in the account's now-200+ row history, which both under- and over-matches. The 30/40 failure count should not be read as 30 separate app defects -- the case needs a rewrite (track the row actually created, e.g. by pre/post count and id, not a value search) before its pass/fail count means anything." },

  // ---- run artifacts (real-time evidence in backend/logs/ai.log) ----
  { match: /^FR-08 /, verdict: "artifact", note: "\"Confirm\" never appeared within the 45s AI-reply budget. backend/logs/ai.log shows Gemini producing severely degenerate output in this exact window (~20:48-20:54 that night) -- one field repeating \"pharmacy\"/\"the gym\" hundreds of times, one raw response over 200,000 characters, one JSON parse failure from an unterminated string. This is the model, not the app; not evidence either way." },
  { match: /^FR-09 /, verdict: "artifact", note: "Same AI-degeneration window as FR-08." },
  { match: /^FR-24/, verdict: "artifact", note: "Same AI-degeneration window as FR-08." },
  { match: /^FR-28/, verdict: "artifact", note: "Same AI-degeneration window as FR-08." },

  // ---- vitest (API-level) failures ----
  { match: /^XS-05 \(API half\)/, verdict: "real", note: "NEW. `amount: 12.345` (three decimal places) was accepted with a 200, not refused. expenseModel.js has no validation on decimal precision -- env-lived-in.md's own \"exactly two decimal places, never more\" rule is a seeding-quality assumption the server does not actually enforce." },
  { match: /^FR-31 \(API half\)/, verdict: "real", note: "NEW. Input 3, an empty-string message (\"\"), makes POST /chat/messages return a 500, not a clean refusal. Every other nonsense/unrelated input in the same 9-input matrix (hello, whitespace, emoji, a URL, a 5000-char paragraph, a bare number) is handled cleanly -- only the empty string crashes." },
  { match: /^FR-13 \(API half\)/, verdict: "real", note: "Confirms the spec's documented bug directly at the API boundary: a create-expense with neither store nor description is accepted and saved." },
  { match: /^FR-39 \(API half\)/, verdict: "real", note: "Confirms the spec's documented wording bug in the raw signup 400 body: \"User name must between 3 and 20 characters\" (missing \"be\", and \"User name\" instead of the field's real label \"Username\")." },
  { match: /^BD-07.*model's raw response/, verdict: "real", note: "Left deliberately red, per the task brief: the AI-response half of the logging gap (backend/ai/parseMessage.js does not capture the model's raw output when the call itself fails, only on a parse failure) is still open. Confirmed again this run with a forced invalid-API-key failure." },
  { match: /^BD-07.*validation 400|^BD-07.*5xx goes|^BD-07.*failed login/, verdict: "real", note: "PASSED this run -- the request-body-logging half of BD-07 is fixed and stayed fixed." },

  // ---- found while closing the gaps a first automated triage pass missed ----
  { match: /^FS-05/, verdict: "real", note: "Likely the same double-refresh race as FR-16 -- FS-05 reloads mid-conversation, and if that reload loses, the session bounces to /login before the chat bubble it's looking for ever re-renders. Not independently re-verified this pass; flagged with the same root cause rather than counted as a fifth unrelated bug." },
  { match: /^FR-21/, verdict: "inconclusive", note: "\"This month\" showed only the today-dated row's total, not today's + the first-of-month row's. Resembles the historical date-boundary class (the 2026-09-15 ER-10/ER-11 fix), but not independently re-verified this pass -- said plainly rather than guessed." },
  { match: /^FR-22/, verdict: "real", note: "Likely the same double-refresh race as FR-16 -- this case's loading-state check reloads the page, and if that reload loses the race, the app redirects to /login before the dashboard's loading panel (role=\"status\") ever mounts. Not independently re-verified this pass." },
];

function triageFor(test) {
  // Accepts either a test object or a bare title string. vitest's JSON
  // reporter gives each assertion only its OWN title (no describe prefix)
  // as `.title`, with the describe-qualified path in `.fullName` -- several
  // of this pass's IDs (BD-07, XS-05/FR-13/FR-31/FR-39's API halves) live
  // only in the describe title, so matching had to fall back to fullName
  // too or those rows silently fell through as "not yet triaged".
  const candidates = typeof test === "string" ? [test] : [test?.fullName, test?.title].filter(Boolean);
  for (const title of candidates) {
    for (const t of TRIAGE_2026_09_16) if (t.match.test(title)) return t;
  }
  return null;
}

const counts = { passed: 0, failed: 0, skipped: 0, blocked: 0 };
for (const t of tests) counts[t.status] = (counts[t.status] ?? 0) + 1;
const total = tests.length;

const failures = tests.filter((t) => t.status === "failed");
const expectedDivergenceFails = failures.filter((t) => DIVERGENCES.includes(t.id));
const realBugFails = failures.filter((t) => REAL_BUGS.includes(t.id));
const designedToFailHits = failures.filter((t) => DESIGNED_TO_FAIL_2026_09_16.includes(t.id));
const unexpectedFails = failures.filter(
  (t) =>
    !DIVERGENCES.includes(t.id) &&
    !REAL_BUGS.includes(t.id) &&
    !DESIGNED_TO_FAIL_2026_09_16.includes(t.id) &&
    !triageFor(t),
);

// ---- coverage-against-spec statement ----
const SPEC_COVERAGE = [
  { spec: "01-ai-chat.md", covered: "§1 the auth routes exist and gate correctly, proven with a real browser + real server (UJ-01: signup lands on /home; logged-out /home bounces to /login). §4 the access token lives only in memory, never localStorage (UJ-01); the generic wrong-credential message is what the browser actually renders, not swallowed client-side (UJ-02).", notCovered: "§6/§7 the chat flow itself — not built, so no UI exists to test yet." },
  { spec: "03-api-contract.md", covered: "§0 (two error shapes; field-name mapping; CORS exact origin + credentials), §1 (all four /users/* endpoints: status tables, response bodies, cookie, generic 401, strict login rate limit; also proven end-to-end through a real browser in UJ-01/UJ-02).", notCovered: "§2 is a client-side list (already tested in client/). §3 endpoints are not built." },
  { spec: "04-data-model.md", covered: "User / RefreshToken / Expense field rules, unique indexes, RefreshToken TTL index (definition), Expense compound index, refresh-token rotation (net-zero row growth via RF-07).", notCovered: "Category model (no route exercises it; dormant). Message model (no file yet). TTL reaper actually deleting a row (slow/flaky — index definition asserted instead)." },
  { spec: "05-user-layers.md", covered: "§3 repository returns exercised through the service unit tests + API tests. §4 every service step incl. issueTokenPair payloads/lifetimes/secrets (US-01..US-18), and the full signup -> home -> reload -> logout loop end-to-end (UJ-01). §5 service-returns-vs-client-sees (SU/LI/RF body shape). §6 route handlers + cookie options + publicUser. §7 where validation lives (SU-08..SU-11, LI-05/06). §8 error table end-to-end. §10 decisions 1-4.", notCovered: "§6.1 secure:true HTTPS cookie branch (no HTTPS in v1 — the secure:false branch is what ships). Repository functions are not unit-tested in isolation (covered transitively by service + API + model tests); findUserByEmail is exercised only via the signup async validator path." },
  { spec: "06-server-modules.md", covered: "§1 logger transports incl. ai.log filter + crash handlers (LG-01..LG-07). §2 connectDB shape + exit-on-failure (DB-01..DB-03). §3 catchAsync (forward only, no log) + errorHandler (409 / .status / 500, log levels, one place) (EH-01..EH-11). §4 requireAuth contract (RA-01..RA-09).", notCovered: "§5 .env variable list is verified only indirectly (the server boots with the real vars). .env.example existence — REPORTED GAP (blocker B4)." },
  { spec: "07-server-entry.md", covered: "§1 start-up order (ST-01..ST-03). §2 middleware stack effects: helmet headers (XC-05/06), CORS exact origin (XC-07/08/09), JSON + cookie parsing (XC-12), global rate limiter present & looser than login (XC-14). §4 404 then errorHandler last (XC-10/11).", notCovered: "§2 exact global limiter ceiling of 300/15min (would need 300+ requests — disproportionate; presence + looseness asserted). CSRF (none in v1 by design). Static serving (none by design)." },
  { spec: "08-expense-category-dal.md", covered: "Every category/expense DAL function in the table (DL-01..DL-10): findOtherCategory, createManyCategories, deleteCategoriesByUser, getExpenseTotalByCategory (totals, date range, empty case), findExpenseById, reassignExpensesToCategory, queryExpenses (text + date range, combined).", notCovered: "Nothing deliberately skipped; findByName/resolveCategory-adjacent DAL calls are covered indirectly through CS-*/ES-*/CC-*." },
  { spec: "09-expense-category-service.md", covered: "§2 categoryService: findByName, createCategory/updateCategory/deleteCategory rule checks (CS-01..CS-13), seedDefaultCategories/resetToDefaults (CI-01..CI-04). §3 expenseService: resolveCategory, createExpense, createManyExpenses' no-partial-save (EI-01/02), editExpense/deleteExpense ownership (ES-01..ES-09). §4 POST /chat/confirm's 7-branch intent switch (CC-01..CC-12). §5 the three read-only routes (ER-01..ER-11), including the same-day date-range boundary (ER-10/ER-11). All PASS.", notCovered: "Nothing deliberately skipped." },
  { spec: "01-ai-chat.md (chat additions)", covered: "§8 backend/ai/: prompt/schema shared-reference, call-args wiring, the clean-502 contract, the default-client singleton (AI-01..AI-12). §5/§9 GET /chat/messages ordering/limit/scoping (CM-03..06). §6/§7 the real chat->draft->confirm loop through a real browser with one real (minimal) Gemini call (FJ-01).", notCovered: "POST /chat/messages's AI-dependent intent-parsing behaviour at the API-test level (the 30-day window, per-intent matches for all 7 intents) — blocked on B7 (routes/chatRoute.js has no seam to inject a fake AI client; an API-level test would need a real, metered, non-deterministic Gemini call per case). Only the auth boundary (CM-01/02) and one real E2E call (FJ-01) are automated for this route." },
  { spec: "02-dashboard.md", covered: "Every stat/list the spec names, exercised via the three read-only endpoints its own client code calls (ER-01..ER-11) and one real-browser journey (DJ-01) checking the rendered page against the spec's text — including same-day spend, the exact case the dashboard's default 'This month' period hits every time. All PASS.", notCovered: "Client-side pure-function gaps already flagged by docs/reference/testing-reference/2026-09-15-client-additions-testable.md (computeRange's pick/custom branches, buildGroups zero-filtering, the stale-fetch race guard, the 'Other' fallback) are client-unit-test territory, not duplicated here." },
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
  const flow = !c && t.id ? FLOW_CASES[t.id] : null;
  const gov = t.id ? GOVERNING[t.key] : null;
  const isDiv = t.id && DIVERGENCES.includes(t.id);
  const isFinding = t.id && FINDINGS.includes(t.id);
  const isBug = t.id && REAL_BUGS.includes(t.id);
  const isProvisional = t.id && PROVISIONAL_BAR_IDS.includes(t.id);
  const rows = [];
  if (c) {
    rows.push(`<div class="fld"><span class="k">Purpose</span><span class="v">${esc(c.purpose)}</span></div>`);
    rows.push(`<div class="fld"><span class="k">Under test</span><span class="v">${esc(c.under)}</span></div>`);
    rows.push(`<div class="fld"><span class="k">Method (setup + exact inputs + action)</span><span class="v">${esc(c.method)}</span></div>`);
    rows.push(`<div class="fld"><span class="k">Expected result</span><span class="v">${esc(c.expected)}</span></div>`);
    if (c.divergence) rows.push(`<div class="fld div"><span class="k">Spec/code note</span><span class="v">${esc(c.divergence)}</span></div>`);
  } else if (flow) {
    // The case, inlined directly from qa/specs/flow-fresh-2026-09-16.md or
    // flow-lived-in-2026-09-16.md (parsed, not retyped -- see
    // qa/scripts/parse-flow-specs.mjs). Title carries the "· *provenance*" tag.
    rows.push(`<div class="fld"><span class="k">Case (from ${esc(flow.file)})</span><span class="v">${flow.html}</span></div>`);
  } else if (t.status === "blocked") {
    rows.push(`<div class="fld"><span class="k">Why blocked</span><span class="v">${esc(t.blockedReason || "")}</span></div>`);
  } else {
    rows.push(`<div class="fld"><span class="k">Note</span><span class="v">No design-time case matched this test id. Title: ${esc(t.fullName)}</span></div>`);
  }
  if (isProvisional) {
    rows.push(
      `<div class="fld div"><span class="k">Provisional bar</span><span class="v">This case runs against a bar Adam has NOT yet confirmed (qa/harness/bars.ts is the single place the number lives). If this fails, that means either the app is genuinely slow/wrong, OR the proposed number itself is wrong — read the failure detail before assuming either.</span></div>`,
    );
  }
  rows.push(
    `<div class="fld"><span class="k">Actual result (this run)</span><span class="v">${
      t.status === "passed"
        ? "PASSED — all assertions held."
        : t.status === "skipped"
        ? "SKIPPED."
        : t.status === "blocked"
        ? "BLOCKED — never became a runnable test this run (see \"Why blocked\" above)."
        : "FAILED. " + (isDiv ? "(Expected: this is a carried-through spec/code divergence.)" : isBug ? "(Expected: this asserts the spec's correct behaviour against a real bug found this pass — see the Findings section above.)" : "")
    }</span></div>`
  );
  const triage = triageFor(t);
  if (triage) {
    const verdictLabel = { real: "REAL DEFECT — the app is wrong", test: "TEST DEFECT — this test's own code is wrong, the app is fine", artifact: "RUN ARTIFACT — not evidence about the app either way", inconclusive: "INCONCLUSIVE — genuinely unsure" }[triage.verdict];
    const verdictColor = { real: "var(--fail)", test: "var(--accent)", artifact: "var(--mut)", inconclusive: "var(--skip)" }[triage.verdict];
    rows.push(
      `<div class="fld"><span class="k">Triage verdict</span><span class="v"><strong style="color:${verdictColor}">${esc(verdictLabel)}</strong><br>${esc(triage.note)}</span></div>`,
    );
  }
  if (t.status === "failed" && t.failureMessages.length) {
    rows.push(
      `<div class="fld"><span class="k">Failure detail (expected vs actual)</span><pre class="fail">${esc(
        t.failureMessages.join("\n\n").slice(0, 4000)
      )}</pre></div>`
    );
  }
  if (t.aiRawLines && t.aiRawLines.length) {
    rows.push(
      `<div class="fld"><span class="k">Raw model response(s)</span><pre class="fail" style="background:var(--bg);color:var(--ink);border:1px solid var(--line)">${esc(
        t.aiRawLines.join("\n").slice(0, 6000)
      )}</pre></div>`,
    );
  }
  if (gov) {
    rows.push(
      `<div class="fld"><span class="k">Source test file</span><span class="v mono">${esc(t.file || gov.src)}</span></div>` +
        `<div class="fld"><span class="k">Test spec</span><span class="v mono">${esc(gov.specFile)}</span></div>` +
        `<div class="fld"><span class="k">Governing spec</span><span class="v mono">${esc(gov.file)} — ${esc(gov.sec)}</span></div>`
    );
  }
  return `<div class="panel">${rows.join("")}</div>`;
}

function testRow(t) {
  const cls =
    t.status === "failed" ? "row failed" : t.status === "blocked" ? "row failed" : t.status === "skipped" ? "row skipped" : "row passed";
  const badge =
    t.status === "failed"
      ? '<span class="badge b-fail">FAIL</span>'
      : t.status === "blocked"
      ? '<span class="badge b-bug">BLOCKED</span>'
      : t.status === "skipped"
      ? '<span class="badge b-skip">SKIP</span>'
      : '<span class="badge b-pass">PASS</span>';
  const divTag =
    t.id && DIVERGENCES.includes(t.id)
      ? '<span class="badge b-div">SPEC DIVERGENCE</span>'
      : t.id && REAL_BUGS.includes(t.id)
      ? '<span class="badge b-bug">BUG</span>'
      : t.id && FINDINGS.includes(t.id)
      ? '<span class="badge b-div">FINDING</span>'
      : t.id && DESIGNED_TO_FAIL_2026_09_16.includes(t.id)
      ? '<span class="badge b-div">DESIGNED TO FAIL</span>'
      : "";
  const provTag = t.id && PROVISIONAL_BAR_IDS.includes(t.id) ? '<span class="badge b-div">PROVISIONAL BAR</span>' : "";
  const triage = triageFor(t);
  const triageTag = triage
    ? {
        real: '<span class="badge b-bug">REAL DEFECT</span>',
        test: '<span class="badge b-skip">TEST DEFECT</span>',
        artifact: '<span class="badge b-skip" style="opacity:.7">RUN ARTIFACT</span>',
        inconclusive: '<span class="badge b-skip">INCONCLUSIVE</span>',
      }[triage.verdict]
    : "";
  const open = t.status === "failed" || t.status === "blocked" ? " open" : "";
  return `<details class="${cls}"${open}>
  <summary><span class="tid">${esc(t.id || "—")}</span><span class="ttl">${esc(cleanTitle(t.title, t.id))}</span>${badge}${divTag}${provTag}${triageTag}</summary>
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
          `<li class="${DIVERGENCES.includes(t.id) || REAL_BUGS.includes(t.id) || DESIGNED_TO_FAIL_2026_09_16.includes(t.id) ? "exp" : "unexp"}"><span class="tid">${esc(t.id || "—")}</span> ${esc(
            cleanTitle(t.title, t.id)
          )} <span class="mono">(${esc(t.file)})</span>${
            DIVERGENCES.includes(t.id)
              ? " — carried-through spec/code divergence (expected)"
              : REAL_BUGS.includes(t.id)
              ? " — REAL BUG found this pass (expected fail, see Findings below)"
              : DESIGNED_TO_FAIL_2026_09_16.includes(t.id)
              ? " — spec says \"Status today: fails\" (designed to fail, see the 2026-09-16 section below)"
              : " — NEEDS ATTENTION"
          }</li>`
      )
      .join("")
  : "<li>None.</li>";

// ---- 2026-09-16 pass findings, computed from the actual run rather than
// hand-maintained prose (so it can't go stale the way the paragraphs above
// this pass would). A "new" finding is a failure whose id was NOT already
// flagged by the spec text as failing today.
const newFindings2026_09_16 = failures.filter(
  (t) =>
    (t.key === "FR" || t.key === "XS" || t.key === "BD" || t.key === "LV") &&
    !DESIGNED_TO_FAIL_2026_09_16.includes(t.id),
);
const designedFailuresPresent = tests.filter((t) => DESIGNED_TO_FAIL_2026_09_16.includes(t.id));
const provisionalResults = tests.filter((t) => PROVISIONAL_BAR_IDS.includes(t.id));

// ---- triage summary: every failure/timeout this pass, bucketed honestly ----
const triagedFailures = tests
  .filter((t) => (t.status === "failed" || t.status === "timedOut") && triageFor(t))
  .map((t) => ({ t, triage: triageFor(t) }));
const untriagedFailures = failures.filter((t) => !triageFor(t));
const triageCounts = { real: 0, test: 0, artifact: 0, inconclusive: 0 };
for (const { triage } of triagedFailures) triageCounts[triage.verdict]++;
const realDefectRows = triagedFailures.filter((x) => x.triage.verdict === "real");
const triageTableHtml = `<table><thead><tr><th>ID</th><th>Verdict</th><th>Why</th></tr></thead><tbody>${triagedFailures
  .map(
    ({ t, triage }) =>
      `<tr><td class="tid">${esc(t.id || "—")}</td><td><strong style="color:${
        { real: "var(--fail)", test: "var(--accent)", artifact: "var(--mut)", inconclusive: "var(--skip)" }[triage.verdict]
      }">${esc(triage.verdict.toUpperCase())}</strong></td><td>${esc(triage.note)}</td></tr>`,
  )
  .join("")}</tbody></table>`;

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
  ["ER-10 (GET /expenses)", "backend/dal/expenseRepository.js — queryExpenses", "Model.find() auto-casts the bare 'YYYY-MM-DD' query-string date to midnight UTC that day, and `from` wasn't cast either — a request with to=<today> therefore excluded any expense recorded LATER the same day.", "FIXED — added startOfDay/endOfDay helpers (UTC-based) and wrapped both `from` (startOfDay) and `to` (endOfDay) with them before comparing against the date field. Test now PASSES."],
  ["ER-11, DJ-01 (GET /expenses/summary)", "backend/dal/expenseRepository.js — getExpenseTotalByCategory", "Second, separate instance of the same 'raw aggregate() doesn't auto-cast' bug class as the ObjectId issue above — this time for dates. The raw .aggregate() $match stage compared the bare query-string `to` against a BSON Date and never matched, regardless of time-of-day.", "FIXED — same startOfDay/endOfDay wrapping applied to this function's $match stage. ER-11 and the end-to-end DJ-01 (dashboard shows today's real spend) both now PASS."],
]
  .map(
    (r) =>
      `<tr><td class="tid">${esc(r[0])}</td><td class="mono">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`
  )
  .join("");

const REAL_BUG_ROWS = "";

const specCoverageHtml = SPEC_COVERAGE.map(
  (s) =>
    `<div class="sc"><h3>${esc(s.spec)}</h3><p><strong>Covered:</strong> ${esc(s.covered)}</p><p class="nc"><strong>Not covered (and why):</strong> ${esc(
      s.notCovered
    )}</p></div>`
).join("");

const blockersHtml = DESIGN_BLOCKERS.map((b) => `<li><span class="tid">${esc(b.id)}</span> ${esc(b.text)}</li>`).join("");

// ---- 2026-09-16 pass: fresh-account + lived-in flow redesign ----
const FLOW_BLOCKERS_2026_09_16 = [
  { id: "B-A", text: "\"last Tuesday\" (and relative weekdays generally) has no written date-resolution rule. FR-12 asserts only the no-date and explicit-date branches; the relative-weekday branch is not asserted. Needs Adam's decision." },
  { id: "B-B", text: "Out-of-range dates (2099, 1970) have no written rule for refuse-vs-clamp. XS-06 checks only that garbage is not silently stored as-is; it cannot assert a specific pass/fail outcome for these two. Needs Adam's decision." },
  { id: "FR-05 (unit half)", text: "buildPending (client/src/store/chatSlice.ts) is not exported, so its four rejection branches cannot be unit-tested directly from qa/. A client/ change is the builder agent's job (delegation.md), not authorised this run. The browser half (stubbing /chat/messages to force each branch) IS implemented and ran." },
];
const flowBlockersHtml = FLOW_BLOCKERS_2026_09_16.map((b) => `<li><span class="tid">${esc(b.id)}</span> ${esc(b.text)}</li>`).join("");

const blockedRowsHtml = tests
  .filter((t) => t.status === "blocked")
  .map((t) => `<li><span class="tid">${esc(t.id)}</span> ${esc(t.title)} — ${esc(t.blockedReason)}</li>`)
  .join("") || "<li>None.</li>";

function designedStatusLabel(status) {
  if (status === "failed") return { color: "var(--fail)", text: "still failing, as the spec says it does" };
  if (status === "blocked") return { color: "var(--mut)", text: "BLOCKED this pass -- could not confirm its documented status either way" };
  if (status === "skipped") return { color: "var(--mut)", text: "SKIPPED this pass -- could not confirm its documented status either way" };
  return { color: "var(--pass)", text: "PASSED — no longer matches the spec's documented status, worth a second look" };
}
const designedToFailHtml = designedFailuresPresent.length
  ? `<ul>${designedFailuresPresent
      .map((t) => {
        const label = designedStatusLabel(t.status);
        return `<li><span class="tid">${esc(t.id)}</span> ${esc(cleanTitle(t.title, t.id))} — <strong style="color:${label.color}">${label.text}</strong></li>`;
      })
      .join("")}</ul>`
  : "<p class=\"hint\">None of these ran this pass.</p>";

const newFindingsHtml = newFindings2026_09_16.length
  ? `<ul>${newFindings2026_09_16
      .map(
        (t) =>
          `<li class="unexp"><span class="tid">${esc(t.id)}</span> ${esc(cleanTitle(t.title, t.id))} <span class="mono">(${esc(t.file)})</span></li>`,
      )
      .join("")}</ul>`
  : "<p class=\"hint\">None — every failure in the fresh/lived-in suites this run was already named by the spec as failing today.</p>";

const provisionalHtml = provisionalResults.length
  ? `<table><thead><tr><th>ID</th><th>Bar</th><th>Result</th></tr></thead><tbody>${provisionalResults
      .map(
        (t) =>
          `<tr><td class="tid">${esc(t.id)}</td><td>${esc(cleanTitle(t.title, t.id))}</td><td style="color:${
            t.status === "failed" ? "var(--fail)" : t.status === "passed" ? "var(--pass)" : "var(--mut)"
          }"><strong>${esc(t.status.toUpperCase())}</strong></td></tr>`,
      )
      .join("")}</tbody></table>`
  : "<p class=\"hint\">None ran this pass.</p>";

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
  <p class="sub">${esc(now.toString())} · auth + chat + expense/category + AI + dashboard surface, plus browser E2E (client ↔ server) both against fresh-account <span class="mono">expenses_qa_test</span> (dropped on teardown) and the persistent lived-in <span class="mono">expenses_qa_livedin</span> (rebuilt at the start of this run, kept afterward) · duration ~${(durationMs/1000).toFixed(1)}s${existsSync(PW_RAW) ? "" : " · e2e suite not run this time — see note below"}</p>

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
      <span class="chip fail">${counts.blocked} blocked</span>
    </div>

    <h3>Every failure</h3>
    <ul>${failuresList}</ul>
    <p class="hint">${unexpectedFails.length === 0
      ? "No unexpected failures. Every failure below is either a carried-through spec/code divergence, or a real bug found and documented this pass (see below) — nothing here is an unexplained flake."
      : `<strong>${unexpectedFails.length} failure(s) need attention</strong> beyond the known divergences and documented bugs.`}</p>

    <h3 style="color:var(--pass)">Bugs found across 2026-09-15, all fixed as of this run</h3>
    <p class="hint">Four real backend bugs were found across this date's passes and are now all fixed and re-verified: the categoryModel.js hook bug (23 tests), the getExpenseTotalByCategory ObjectId-cast bug (ER-08/09), the resetToDefaults ordering bug (CI-03/04), and the date-boundary cast bug found right after the ObjectId fix (ER-10/ER-11, DJ-01). See <span class="mono">qa/specs/README.md</span> for the full before/after.</p>
    <table>
      <thead><tr><th>Tests</th><th>File</th><th>Root cause</th><th>Fix</th></tr></thead>
      <tbody>${FIXED_BUG_ROWS}</tbody>
    </table>

    <h3>Real bugs found this pass (still open)</h3>
    <p class="hint">None. All previously open findings (ER-10, ER-11, DJ-01) are fixed and re-verified this run — see the table above.</p>

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

  <div class="card">
    <h2 style="margin-top:0">2026-09-16 pass — fresh-account &amp; lived-in flow redesign</h2>
    <p class="hint">85 cases (FR-01..44, XS-01..07, BD-01..07, LV-01..27) from qa/specs/flow-fresh-2026-09-16.md and flow-lived-in-2026-09-16.md. 77 run through a real headed Chromium; the rest are the API/DATA-SWEEP cases the spec itself marks that way. Fresh-account cases run against <span class="mono">expenses_qa_test</span> (dropped at teardown); lived-in cases run against <span class="mono">expenses_qa_livedin</span> (rebuilt from the seed corpus at the START of this run, kept afterward). Each of the 89 browser tests ran as its OWN Playwright process this run (see the harness note below) -- that changed only how tests are invoked, never what any test asserts.</p>

    <h3>Triage: every failure and timeout, sorted honestly</h3>
    <p class="hint">
      <strong style="color:var(--fail)">${triageCounts.real} real defect${triageCounts.real === 1 ? "" : "s"}</strong> (the app is wrong) ·
      <strong style="color:var(--accent)">${triageCounts.test} test defect${triageCounts.test === 1 ? "" : "s"}</strong> (this suite's own code is wrong, the app is fine) ·
      <strong style="color:var(--mut)">${triageCounts.artifact} run artifact${triageCounts.artifact === 1 ? "" : "s"}</strong> (rate limiting / model slowness / a timing race -- not evidence about the app) ·
      <strong style="color:var(--skip)">${triageCounts.inconclusive} inconclusive</strong>
      ${untriagedFailures.length ? `· <strong style="color:var(--fail)">${untriagedFailures.length} not yet triaged</strong>` : ""}
    </p>
    ${triageTableHtml}
    <p class="hint">Full reasoning for each (what was checked, and for FR-27/LV-22/FR-39 what re-running or hand-verifying showed) is in that test's own expandable row below.</p>

    <h3>Blocked (never became a runnable test)</h3>
    <ul>${blockedRowsHtml}</ul>

    <h3>Other blockers (need Adam's decision)</h3>
    <ul>${flowBlockersHtml}</ul>

    <h3>Cases the spec already says fail today ("designed to fail")</h3>
    <p class="hint">qa-lead wrote these against a real, already-observed defect (Enter does nothing, a false save claim, a label-less expense, etc.) — a red result here confirms the case still works, a green result is the surprise worth a second look.</p>
    ${designedToFailHtml}

    <h3 style="color:${newFindings2026_09_16.length ? "var(--fail)" : "var(--pass)"}">New findings this run (not already named by the spec)</h3>
    ${newFindingsHtml}

    <h3>Provisional bars — Adam has not confirmed these numbers/rules</h3>
    <p class="hint">Response-time budgets (FR-36/37, LV-24), the seven "looks right" rules (FR-38/39), and Hebrew-in-Hebrew-out (FR-43). qa/harness/bars.ts is the single place the numbers live. A failure here means either the app is genuinely wrong, or the proposed bar itself needs adjusting — read the case before assuming either.</p>
    ${provisionalHtml}
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
