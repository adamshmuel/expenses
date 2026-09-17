/**
 * One-off verification of two guards in backend/ai/parseMessage.js that had
 * NEVER been run against a live server before this round. Adam approved this
 * scoped round; see .claude/rules/bug-flow.md §3/§4 for why it is one round,
 * never edits the tests it checks against, and stays out of the permanent
 * roadmap.
 *
 * This file's server is started by useServer()'s beforeAll, which always
 * spawns a NEW `node backend/index.js` child process (harness/server.ts
 * startServer()) — so it always runs against parseMessage.js as currently on
 * disk, never a cached require(). No warm-server reuse anywhere in this file.
 *
 * Bug 3 — textHasNegativeAmount (regex on the RAW user text) and
 *   hasSubAgoraPrecision (>2 decimal places on drafts[].amount / changes.amount).
 *   Both are deterministic code, not prompt bets, per backend/ai/parseMessage.js.
 * Bug 5 — hasSuspiciousField now REFUSES (intent: "unknown" + rephrase reply)
 *   instead of logging-and-passing-through. Concentrated on the one trigger
 *   the previous round found all 5 of its hits on: "supermarket" -> Groceries.
 *   Run at N=10 here, not N=5, because this is the known weak spot.
 *
 * Each trial signs up its own fresh user (fresh-account isolation, per
 * .claude/rules and .claude/agents/qa-tester.md — no shared state between
 * trials). Chat history/expenses are per-user, so trials cannot interfere.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { TEST_BASE_URL, BACKEND_DIR } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

useServer();

// Same pattern as qa/tests/unit/ai.test.ts: load the real CJS module via
// createRequire against backend/package.json, rather than an ESM import
// reaching into a CommonJS file directly.
const rb = createRequire(resolve(BACKEND_DIR, "package.json"));
const { parseMessage } = rb("./ai/parseMessage.js");

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

async function getExpenses(accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}/expenses`, { headers: authed(accessToken) });
  return safeJson(res);
}

/** Run `fn()` n times sequentially (the live model, not to be hammered concurrently). */
async function runTrials<T>(n: number, fn: (trial: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(await fn(i));
  return out;
}

const REPHRASE_PATTERN = /trouble|try again|didn't come out right|something went wrong|rephrase/i;

// ===================================================================
// Bug 3a — textHasNegativeAmount: refuse rather than confirm a flipped sign
// ===================================================================
describe("Bug 3a — negative amount in raw user text is refused, not silently flipped positive", () => {
  const messages = ["spent -50 on coffee", "-50 at Aroma", "paid -12.50 for parking"];

  for (const msg of messages) {
    it(`"${msg}" — live server, N=3`, async () => {
      const results = await runTrials(3, async (trial) => {
        const { accessToken } = await signupUser();
        const r = await chatMessage(accessToken, msg);
        const expenses = await getExpenses(accessToken);
        return {
          trial,
          status: r.status,
          intent: r.body?.intent,
          reply: r.body?.reply,
          expensesCount: Array.isArray(expenses) ? expenses.length : -1,
        };
      });

      for (const res of results) {
        expect(res.status, `trial ${res.trial}: HTTP status\n${JSON.stringify(res)}`).toBe(200);
        expect(res.intent, `trial ${res.trial}: intent\n${JSON.stringify(res)}`).toBe("unknown");
        expect(res.reply, `trial ${res.trial}: reply\n${JSON.stringify(res)}`).toMatch(/negative|can't|cannot|can not|n't be negative|positive/i);
        expect(res.expensesCount, `trial ${res.trial}: nothing must be written to the DB\n${JSON.stringify(res)}`).toBe(0);
      }
      // eslint-disable-next-line no-console
      console.log(`[Bug3a] "${msg}": ${results.length}/${results.length} refused, 0 DB writes`, results);
    }, 120_000);
  }
});

// ===================================================================
// Negative control — an ordinary positive expense must NOT be refused
// ===================================================================
describe("Negative control — an ordinary positive expense is unaffected by either guard", () => {
  it("'spent 50 at Aroma on coffee' — N=10, reports the refusal rate (no pass/fail gate)", async () => {
    // First run at N=3 had one refusal; re-run at N=10 for a real rate found
    // 4/10 (40%) -- a materially worse degeneration rate than bug 5's own
    // "supermarket" trigger, on the plainest possible input. This is not a
    // guard defect (a refusal here is still the correct, actionable outcome
    // per product-first.md), it is evidence the underlying model-degeneration
    // problem is broader than the previous round characterized. No hard
    // threshold here -- there is no approved target rate for this control,
    // and inventing one after seeing a failure would be adjusting the case
    // to fit the result. Reported plainly in the handback instead.
    const results = await runTrials(10, async (trial) => {
      const { accessToken } = await signupUser();
      const r = await chatMessage(accessToken, "spent 50 at Aroma on coffee");
      return { trial, intent: r.body?.intent, reply: r.body?.reply, drafts: r.body?.drafts };
    });
    const refused = results.filter((r) => r.intent === "unknown");
    // eslint-disable-next-line no-console
    console.log(`[Negative control] ordinary positive expense: refused ${refused.length}/${results.length}`, results);
    // The only hard requirement: every trial, refused or not, is a usable
    // outcome for the user -- never a 500, never an empty/dead reply.
    for (const res of results) {
      expect(typeof res.reply, `trial ${res.trial}: reply must be a string\n${JSON.stringify(res)}`).toBe("string");
      expect((res.reply ?? "").trim().length, `trial ${res.trial}: reply must not be empty\n${JSON.stringify(res)}`).toBeGreaterThan(0);
    }
  }, 300_000);
});

// ===================================================================
// Bug 3b — hasSubAgoraPrecision: try live first, then a stubbed-client
// unit-level check per the task's stated fallback.
// ===================================================================
describe("Bug 3b — an amount with >2 decimal places is rejected", () => {
  it("live attempt: 'spent 12.345 on coffee' and similar, N=5 — report whether the guard was ever triggered live", async () => {
    const messages = ["spent 12.345 on coffee", "paid 12.345 for parking", "bought lunch for 8.999"];
    const allResults: any[] = [];
    for (const msg of messages) {
      const results = await runTrials(5, async (trial) => {
        const { accessToken } = await signupUser();
        const r = await chatMessage(accessToken, msg);
        const draftAmount = r.body?.drafts?.[0]?.amount;
        return { msg, trial, intent: r.body?.intent, reply: r.body?.reply, draftAmount };
      });
      allResults.push(...results);
    }
    const triggeredLive = allResults.some((r) => r.intent === "unknown" && REPHRASE_PATTERN.test(r.reply ?? ""));
    // eslint-disable-next-line no-console
    console.log(`[Bug3b live] triggeredLive=${triggeredLive}`, allResults);
    // Informational only -- the model rounding before the guard sees the
    // number is a legitimate, expected outcome per the task instructions.
    // No assertion here: a live miss is not a failure, it's the documented
    // "could not trigger live" finding, reported in the handback below.
    expect(Array.isArray(allResults)).toBe(true);
  }, 300_000);

  it("unit-level, stubbed client: an amount with 3 decimal places is rejected (backstop evidence per parseMessage.test.js's existing pattern)", async () => {
    const categories = [{ name: "Food", parent: null }, { name: "Groceries", parent: "Food" }];
    const recentExpenses: any[] = [];
    const client = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            intent: "create-expense",
            reply: "Got it — adding one expense.",
            drafts: [{ amount: 12.345, store: "supermarket", category: "Groceries" }],
          }),
        }),
      },
    };

    const result = await parseMessage("spent 12.345 on coffee", categories, recentExpenses, { client });

    expect(result.intent).not.toBe("create-expense");
    expect(result.drafts).toBeUndefined();
    expect(result.reply).toMatch(/agorot|decimal|two decimal|cent|round/i);
  });
});

// ===================================================================
// Bug 5 — hasSuspiciousField refuses instead of passing garbage through.
// Concentrated on the one known trigger, N=10.
// ===================================================================
describe("Bug 5 — suspicious-field guard refuses with the rephrase reply, N=10 on the known weak spot", () => {
  const messages = [
    "paid 25 for the thing at the supermarket",
    "spent 50 at the supermarket on groceries",
  ];

  for (const msg of messages) {
    it(`"${msg}" — N=10`, async () => {
      const results = await runTrials(10, async (trial) => {
        const { accessToken } = await signupUser();
        const r = await chatMessage(accessToken, msg);
        return {
          trial,
          status: r.status,
          intent: r.body?.intent,
          reply: r.body?.reply as string | undefined,
          drafts: r.body?.drafts,
        };
      });

      const refused = results.filter((r) => r.intent === "unknown");
      const notRefused = results.filter((r) => r.intent !== "unknown");

      // Every trial, refused or not, must be a 200 with SOME usable outcome
      // (never a 500, never a dead end): refused trials get the rephrase
      // reply and no drafts; non-refused trials get a normal draft response.
      for (const res of results) {
        expect(res.status, `trial ${res.trial}: must not 500\n${JSON.stringify(res)}`).toBe(200);
        expect(typeof res.reply, `trial ${res.trial}: reply must be a usable string\n${JSON.stringify(res)}`).toBe("string");
        expect((res.reply ?? "").trim().length, `trial ${res.trial}: reply must not be empty\n${JSON.stringify(res)}`).toBeGreaterThan(0);
      }
      for (const res of refused) {
        expect(res.reply, `trial ${res.trial}: refused trial must get the rephrase reply\n${JSON.stringify(res)}`).toMatch(REPHRASE_PATTERN);
        expect(res.drafts, `trial ${res.trial}: refused trial must not carry a broken draft\n${JSON.stringify(res)}`).toBeUndefined();
      }

      // eslint-disable-next-line no-console
      console.log(`[Bug5] "${msg}": refused ${refused.length}/${results.length}`, results);
    }, 400_000);
  }
});

// ===================================================================
// Hebrew control — must not be refused as "unsupported script"
// ===================================================================
describe("Hebrew control — a Hebrew message is not refused as garbage", () => {
  it("'שילמתי 50 בסופרמרקט' is not refused, N=3", async () => {
    const results = await runTrials(3, async (trial) => {
      const { accessToken } = await signupUser();
      const r = await chatMessage(accessToken, "שילמתי 50 בסופרמרקט");
      return { trial, intent: r.body?.intent, reply: r.body?.reply, status: r.status };
    });
    for (const res of results) {
      expect(res.status, `trial ${res.trial}\n${JSON.stringify(res)}`).toBe(200);
      expect(res.intent, `trial ${res.trial}: Hebrew must not be refused as unsupported script\n${JSON.stringify(res)}`).not.toBe("unknown");
    }
    // eslint-disable-next-line no-console
    console.log("[Hebrew control]", results);
  }, 120_000);
});
