/**
 * API test: qa/specs/flow-fresh-2026-09-16.md BD-07 -- a failure can be
 * reconstructed afterwards, from the log files alone. Drives failures on
 * /chat/messages, /chat/confirm, a validation 400, and a 500, then reads
 * backend/logs/*.log the way an investigator (not this suite) would.
 * Layer: API (drives the failure) + direct log-file assertions.
 * Environment: fresh.
 *
 * KNOWN OPEN (per the task brief and qa-lead's spec): the AI-response half
 * of the logging gap is recorded as still open -- this file's last
 * assertion is EXPECTED TO FAIL until that is fixed. Not adjusted to pass.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { TEST_BASE_URL, BACKEND_LOGS } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { restartServer } from "../../harness/server.js";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

useServer();

function tail(file: string, sinceLength: number): string {
  const full = resolve(BACKEND_LOGS, file);
  if (!existsSync(full)) return "";
  const content = readFileSync(full, "utf8");
  return content.slice(sinceLength);
}
function lengthOf(file: string): number {
  const full = resolve(BACKEND_LOGS, file);
  return existsSync(full) ? readFileSync(full, "utf8").length : 0;
}

async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string, user: r.user };
}
function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

describe("BD-07 -- observability: a failure can be reconstructed from the logs alone", () => {
  it("a validation 400 on /chat/confirm logs the request body", async () => {
    const { accessToken } = await signupUser();
    const before = lengthOf("app.log");
    const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, {
      method: "POST",
      headers: authed(accessToken),
      body: JSON.stringify({ intent: "create-expense", drafts: [{ amount: -5, category: "Food" }] }),
    });
    await safeJson(res);
    const newLines = tail("app.log", before);
    expect(newLines, "BD-07: nothing new logged for a validation failure").not.toBe("");
    expect(newLines).toContain('"drafts"');
  });

  it("a 5xx goes to error.log, a deliberate 4xx does not", async () => {
    const { accessToken } = await signupUser();
    const errBefore = lengthOf("error.log");

    // A deliberate 4xx (missing category -> resolveCategory throws a 400).
    await fetch(`${TEST_BASE_URL}/chat/confirm`, {
      method: "POST",
      headers: authed(accessToken),
      body: JSON.stringify({ intent: "create-expense", drafts: [{ amount: 5, category: "NoSuchCategoryAtAll" }] }),
    });
    const afterDeliberate4xx = lengthOf("error.log");
    expect(afterDeliberate4xx, "BD-07: a deliberate 4xx must NOT be written to error.log").toBe(errBefore);

    // A genuine 5xx: malformed body the route can't handle safely.
    const res500 = await fetch(`${TEST_BASE_URL}/chat/confirm`, {
      method: "POST",
      headers: authed(accessToken),
      body: "{not-json",
    });
    expect(res500.status).toBeGreaterThanOrEqual(400);
    if (res500.status >= 500) {
      const afterCrash = lengthOf("error.log");
      expect(afterCrash).toBeGreaterThan(afterDeliberate4xx);
    }
  });

  it("an AI-call failure logs the request and (FINDING, expected to fail) the model's raw response", async () => {
    // Force a real AI-call failure: restart the server for this test only
    // with an invalid GEMINI_API_KEY (a real, honest fault injection --
    // there is no client-injectable-fake-client seam at the route level,
    // blocker B7 from the roadmap, so this is the closest reachable
    // equivalent to "force a 502 from backend/ai/").
    await restartServer({ GEMINI_API_KEY: "qa-forced-invalid-key" });
    try {
      const { accessToken } = await signupUser();
      const before = lengthOf("ai.log");
      const res = await fetch(`${TEST_BASE_URL}/chat/messages`, {
        method: "POST",
        headers: authed(accessToken),
        body: JSON.stringify({ text: "spent 10 on coffee" }),
      });
      expect(res.status).toBeGreaterThanOrEqual(500);
      const newAiLines = tail("ai.log", before);
      expect(newAiLines, "BD-07: an AI-call failure logged nothing to ai.log").not.toBe("");
      // The request body half (this session's earlier fix, per the roadmap).
      expect(newAiLines).toContain("spent 10 on coffee");
      // FINDING, expected to fail: the model's raw response half is
      // recorded as still open (task brief + qa-lead's spec BD-07). Kept in
      // the suite red on purpose -- see .claude/rules/tdd.md and the task
      // brief ("a red test here is a correct test, not a broken one").
      expect(newAiLines, "BD-07 FINDING: no raw AI response captured on failure").toMatch(/rawResponse|raw response/i);
    } finally {
      await restartServer({});
    }
  }, 30_000);

  it("a failed login redacts the password everywhere in the logs", async () => {
    const user = makeUser();
    await signup(user);
    const before = lengthOf("app.log");
    await fetch(`${TEST_BASE_URL}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: "wrong-password-xyz" }),
    });
    const newLines = tail("app.log", before);
    expect(newLines).not.toContain("wrong-password-xyz");
    if (newLines.includes('"password"')) expect(newLines).toContain("[redacted]");
  });
});
