/**
 * One-off verification of the backend/ai/prompt.js rewrite (not part of the
 * permanent roadmap — Adam asked for a narrow, multi-trial check of this one
 * change). See .claude/rules/bug-flow.md §3/§4 for why this is scoped to one
 * round and never edits the tests it's checking against.
 *
 * Targets four bugs from docs/reference/testing-reference/2026-09-17-automated-run-findings.md:
 *   1. FR-02/FR-03 — false save claim on free-text "yes" (and unnamed phrasings).
 *   2. FR-10       — a correction acknowledged in prose but dropped from the payload.
 *   5. FR-05       — model deliberation leaking into store/description fields.
 *   8. BD-01       — a false match offer when nothing matches (incl. the >30-day blind spot).
 * Plus a regression check on the ordinary create-expense path.
 *
 * This is a PROBABILISTIC fix against a real model (Gemini Flash Lite via a
 * real POST /chat/messages, real server, real Mongo) — every case below runs
 * N=5 trials and reports a pass RATE, never a single pass/fail. Each trial
 * gets its own signed-up user (fresh-account isolation, per
 * .claude/rules — never .claude/agents/qa-tester.md's "do not share state
 * between tests").
 *
 * ai.log is snapshotted before this file's own server starts, and only bytes
 * APPENDED after that point are scanned for "suspicious field" — ai.log is
 * append-only across runs and shared with the rest of the suite/dev usage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { TEST_BASE_URL, BACKEND_DIR, BACKEND_LOGS } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { readBackendEnv, deriveTestMongoUri } from "../../harness/env.js";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

useServer();

const AI_LOG_PATH = resolve(BACKEND_LOGS, "ai.log");
let aiLogOffsetAtStart = 0;

beforeAll(() => {
  aiLogOffsetAtStart = existsSync(AI_LOG_PATH) ? statSync(AI_LOG_PATH).size : 0;
});

/** Only the ai.log bytes written since this file's server started. */
function aiLogSinceStart(): string {
  if (!existsSync(AI_LOG_PATH)) return "";
  const full = readFileSync(AI_LOG_PATH, "utf8");
  return full.length >= aiLogOffsetAtStart ? full.slice(aiLogOffsetAtStart) : full;
}

function suspiciousFieldWarningsSinceStart(): number {
  const text = aiLogSinceStart();
  return (text.match(/suspicious field/g) ?? []).length;
}

// ---- backend Mongoose access, for seeding the >30-day expense directly ----
const rb = createRequire(resolve(BACKEND_DIR, "package.json"));
const backendMongoose = rb("mongoose") as typeof import("mongoose");
let Expense: any;
let Category: any;

beforeAll(async () => {
  const be = readBackendEnv();
  await backendMongoose.connect(deriveTestMongoUri(be.MONGODB_URI));
  Expense = rb("./models/expenseModel.js");
  Category = rb("./models/categoryModel.js");
});
afterAll(async () => {
  await backendMongoose.disconnect();
});

function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string, userId: r.body.user.id as string };
}

async function chatMessage(accessToken: string, text: string) {
  const res = await fetch(`${TEST_BASE_URL}/chat/messages`, {
    method: "POST",
    headers: authed(accessToken),
    body: JSON.stringify({ text }),
  });
  return { status: res.status, body: await safeJson(res) };
}

async function chatConfirm(accessToken: string, body: any) {
  const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, {
    method: "POST",
    headers: authed(accessToken),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await safeJson(res) };
}

async function getExpenses(accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}/expenses`, { headers: authed(accessToken) });
  return safeJson(res);
}
async function getCategories(accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}/categories`, { headers: authed(accessToken) });
  return safeJson(res);
}

const SAVE_CLAIM_PATTERN = /\b(saved|recorded|filed|logged|added|updated|changed|deleted|removed|done)\b/i;
function looksLikeSaveClaim(text: string): boolean {
  return SAVE_CLAIM_PATTERN.test(text);
}

/** Small helper: run `fn()` N times, collecting pass/fail + a note per trial. */
async function runTrials(n: number, fn: (trial: number) => Promise<{ pass: boolean; note: string }>) {
  const results: { pass: boolean; note: string }[] = [];
  for (let i = 0; i < n; i++) {
    results.push(await fn(i));
  }
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: n, results };
}

function reportRate(label: string, passed: number, total: number, failures: string[]) {
  // eslint-disable-next-line no-console
  console.log(`\n[RATE] ${label}: ${passed}/${total}`);
  for (const f of failures) console.log(`  FAIL: ${f}`);
}

const N = 5;

// ===================================================================
// Check 1 — Bug 1: no false save claim on free-text confirmation words
// ===================================================================
describe("Check 1 — FR-02/FR-03: no false save claim on free-text 'yes' and unnamed variants", () => {
  const phrasings = ["yes", "yes please save it", "ok do it", "save it", "yes, save that for me"];

  for (const phrase of phrasings) {
    it(`"${phrase}" — N=${N} trials`, async () => {
      const failures: string[] = [];
      const { passed, total } = await runTrials(N, async (trial) => {
        const { accessToken } = await signupUser();
        await chatMessage(accessToken, "bought coffee");
        await chatMessage(accessToken, "18");
        await chatMessage(accessToken, "actually it was 22, and it was at Aroma");
        const r = await chatMessage(accessToken, phrase);

        const reply: string = r.body?.reply ?? "";
        const claimsSave = looksLikeSaveClaim(reply);
        const expenses = await getExpenses(accessToken);
        const has22Aroma = expenses.some(
          (e: any) => e.amount === 22 && (e.store === "Aroma" || e.description === "Aroma"),
        );

        // The requirement: no message claims a save happened, AND the DB has
        // no new expense from typing this free text (only Confirm saves).
        const pass = !claimsSave && expenses.length === 0;
        if (!pass) {
          failures.push(
            `trial ${trial}: claimsSave=${claimsSave} expensesCount=${expenses.length} has22Aroma=${has22Aroma} reply="${reply}"`,
          );
        }
        return { pass, note: reply };
      });
      reportRate(`Check1 "${phrase}"`, passed, total, failures);
      // Reported as informational -- the task wants the RATE recorded, not a
      // hard gate that would make this file itself flaky against a
      // probabilistic target. Still fails the suite if it's below half, as a
      // sanity floor.
      expect(passed, `"${phrase}": ${passed}/${total} passed.\n${failures.join("\n")}`).toBeGreaterThanOrEqual(
        Math.ceil(total / 2),
      );
    }, 180_000);
  }
});

// ===================================================================
// Check 2 — Bug 2: a correction reaches the payload, not just the reply
// ===================================================================
describe("Check 2 — FR-10: a correction changes the SAVED value, not just the prose", () => {
  const corrections = ["no, 22", "I said 22", "that's wrong, it was 22"];

  for (const correction of corrections) {
    it(`"${correction}" — N=${N} trials, real Confirm click`, async () => {
      const failures: string[] = [];
      const { passed, total } = await runTrials(N, async (trial) => {
        const { accessToken } = await signupUser();
        const first = await chatMessage(accessToken, "bought coffee");
        const second = await chatMessage(accessToken, "18");
        const corrected = await chatMessage(accessToken, correction);

        // Confirm using whatever the LAST response's drafts say -- exactly
        // what the real UI's Confirm button would send.
        const drafts = corrected.body?.drafts;
        if (!drafts || !Array.isArray(drafts) || drafts.length === 0) {
          return { pass: false, note: `no drafts to confirm: ${JSON.stringify(corrected.body)}` };
        }
        const confirmed = await chatConfirm(accessToken, { intent: "create-expense", drafts });
        const changed = Array.isArray(confirmed.body?.changed) ? confirmed.body.changed[0] : confirmed.body?.changed;
        const savedAmount = changed?.amount;
        const pass = savedAmount === 22;
        if (!pass) {
          failures.push(
            `trial ${trial}: savedAmount=${savedAmount} draftAmount=${drafts[0]?.amount} reply="${corrected.body?.reply}"`,
          );
        }
        return { pass, note: `saved=${savedAmount}` };
      });
      reportRate(`Check2 "${correction}"`, passed, total, failures);
      expect(passed, `"${correction}": ${passed}/${total} passed.\n${failures.join("\n")}`).toBeGreaterThanOrEqual(
        Math.ceil(total / 2),
      );
    }, 180_000);
  }
});

// ===================================================================
// Check 3 — Bug 5: no deliberation leaked into store/description fields
// ===================================================================
describe("Check 3 — FR-05: store/description carry a short final value, never reasoning", () => {
  const messages = [
    "spent 40 at the place near work",
    "bought a birthday present for Dana",
    "paid 25 for the thing at the supermarket",
  ];

  // Text that indicates leaked deliberation, not a real value.
  const DELIBERATION_PATTERN = /\bwait\b|let'?s use|let'?s put|rule-abiding|I think|I'll (use|put)|considering|alternatively/i;

  for (const msg of messages) {
    it(`"${msg}" — N=${N} trials`, async () => {
      const failures: string[] = [];
      const { passed, total } = await runTrials(N, async (trial) => {
        const { accessToken } = await signupUser();
        const r = await chatMessage(accessToken, msg);
        const drafts = r.body?.drafts ?? [];
        const fields: string[] = drafts.flatMap((d: any) => [d.store, d.description].filter(Boolean));

        const anyDeliberation = fields.some((f) => DELIBERATION_PATTERN.test(f));
        const anyOverLong = fields.some((f) => f.length > 200);
        // A Confirm-able draft must actually be offered for these ordinary,
        // if ambiguous, expense messages -- the old symptom was a silently
        // dropped draft with no button and no explanation.
        const hasConfirmableDraft = drafts.length > 0 && drafts.every((d: any) => d.amount != null && d.category != null);

        const pass = !anyDeliberation && !anyOverLong && hasConfirmableDraft;
        if (!pass) {
          failures.push(
            `trial ${trial}: anyDeliberation=${anyDeliberation} anyOverLong=${anyOverLong} hasConfirmableDraft=${hasConfirmableDraft} drafts=${JSON.stringify(drafts)} reply="${r.body?.reply}"`,
          );
        }
        return { pass, note: JSON.stringify(fields) };
      });
      reportRate(`Check3 "${msg}"`, passed, total, failures);
      expect(passed, `"${msg}": ${passed}/${total} passed.\n${failures.join("\n")}`).toBeGreaterThanOrEqual(
        Math.ceil(total / 2),
      );
    }, 180_000);
  }

  it("no 'suspicious field' warning logged to ai.log during Check 3's trials", () => {
    const count = suspiciousFieldWarningsSinceStart();
    // eslint-disable-next-line no-console
    console.log(`[ai.log] suspicious-field warnings since this file's server started: ${count}`);
    // Informational assertion — recorded, not silently ignored, even though
    // the pass-rate checks above are the primary evidence.
    expect(count, "a 'suspicious field' warning fired during this run -- see ai.log excerpt above").toBe(0);
  });
});

// ===================================================================
// Check 4 — Bug 8: no false match offer for edit/delete
// ===================================================================
describe("Check 4 — BD-01: no false match offer when nothing matches", () => {
  const messages = ["change the coffee expense to 30", "delete the amazon expense"];
  const NO_MATCH_PATTERN = /no match|nothing match|couldn'?t find|could not find|no .* expense|not found|don'?t see|do not see/i;
  const PRESUMES_MATCH_PATTERN = /would you like me to (update|change|delete|remove)|I'll (update|change|delete|remove)|I will (update|change|delete|remove)/i;

  describe("4a — account has NO expenses at all", () => {
    for (const msg of messages) {
      it(`"${msg}" — N=${N} trials`, async () => {
        const failures: string[] = [];
        const { passed, total } = await runTrials(N, async (trial) => {
          const { accessToken } = await signupUser();
          const r = await chatMessage(accessToken, msg);
          const reply: string = r.body?.reply ?? "";
          const conditional = NO_MATCH_PATTERN.test(reply) || !PRESUMES_MATCH_PATTERN.test(reply);
          const pass = conditional;
          if (!pass) failures.push(`trial ${trial}: reply="${reply}"`);
          return { pass, note: reply };
        });
        reportRate(`Check4a "${msg}"`, passed, total, failures);
        expect(passed, `"${msg}": ${passed}/${total} passed.\n${failures.join("\n")}`).toBeGreaterThanOrEqual(
          Math.ceil(total / 2),
        );
      }, 180_000);
    }
  });

  describe("4b — account HAS a matching expense, but it's >30 days old (outside the recent-expenses context window)", () => {
    it(`"change the coffee expense to 30" — N=${N} trials, reply must not wrongly deny it exists`, async () => {
      const failures: string[] = [];
      const { passed, total } = await runTrials(N, async (trial) => {
        const { accessToken, userId } = await signupUser();
        const categories = await getCategories(accessToken);
        const food = categories.find((c: any) => c.name === "Food");
        expect(food, "seed setup: this account has no Food category").toBeTruthy();

        // Seed a real, 40-day-old coffee expense directly through the
        // Mongoose model -- same shape the app itself would write (real
        // owned category id, plausible amount, store field only, UTC
        // midnight date), just outside the 30-day recent-expenses window
        // chatRoute.js queries.
        const fortyDaysAgo = new Date();
        fortyDaysAgo.setUTCHours(0, 0, 0, 0);
        fortyDaysAgo.setUTCDate(fortyDaysAgo.getUTCDate() - 40);
        await Expense.create({
          amount: 18,
          store: "Coffee shop",
          date: fortyDaysAgo,
          category: food._id,
          user: userId,
        });

        const r = await chatMessage(accessToken, "change the coffee expense to 30");
        const reply: string = r.body?.reply ?? "";
        // Must NOT plainly deny the expense exists (it does -- just outside
        // context) -- but also must not assert a match as located fact. A
        // conditional reply ("if I find it...") or a request for more
        // detail both satisfy "doesn't wrongly deny it exists".
        const wronglyDenies = /no match|nothing match|couldn'?t find|could not find|no .* expense exists|not found|don'?t see any|do not see any/i.test(reply);
        const pass = !wronglyDenies;
        if (!pass) failures.push(`trial ${trial}: reply="${reply}"`);
        return { pass, note: reply };
      });
      reportRate("Check4b >30-day coffee expense", passed, total, failures);
      expect(passed, `>30-day case: ${passed}/${total} passed.\n${failures.join("\n")}`).toBeGreaterThanOrEqual(
        Math.ceil(total / 2),
      );
    }, 180_000);
  });
});

// ===================================================================
// Check 5 — regression: the ordinary create-expense path still works
// ===================================================================
describe("Check 5 — regression: an ordinary expense still drafts and confirms cleanly", () => {
  it("'spent 50 at the supermarket on groceries' — N=5 trials", async () => {
    const failures: string[] = [];
    const { passed, total } = await runTrials(N, async (trial) => {
      const { accessToken } = await signupUser();
      const r = await chatMessage(accessToken, "spent 50 at the supermarket on groceries");
      const drafts = r.body?.drafts ?? [];
      const draftOk =
        drafts.length === 1 && drafts[0].amount === 50 && drafts[0].category != null;
      if (!draftOk) {
        failures.push(`trial ${trial}: draft not usable: ${JSON.stringify(drafts)} reply="${r.body?.reply}"`);
        return { pass: false, note: "draft" };
      }
      const confirmed = await chatConfirm(accessToken, { intent: "create-expense", drafts });
      const changed = confirmed.body?.changed;
      const pass = confirmed.status === 200 && changed?.amount === 50;
      if (!pass) failures.push(`trial ${trial}: confirm failed: status=${confirmed.status} body=${JSON.stringify(confirmed.body)}`);
      return { pass, note: "confirm" };
    });
    reportRate("Check5 regression", passed, total, failures);
    expect(passed, `regression: ${passed}/${total} passed.\n${failures.join("\n")}`).toBeGreaterThanOrEqual(
      Math.ceil(total / 2),
    );
  }, 180_000);
});
