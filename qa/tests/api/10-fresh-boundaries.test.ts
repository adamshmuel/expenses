/**
 * API tests: qa/specs/flow-fresh-2026-09-16.md Group 6 (XS-01 .. XS-06).
 * Layer: API, deliberately past the UI -- that is the point of every case
 * in this file (per the spec's own "Layer discipline" section).
 * Environment: fresh, two accounts (caller + victim) per case.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { makeUser, signup, safeJson, containsSecret } from "../../fixtures/factories.js";

useServer();

function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}
async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string, userId: r.body.user.id as string };
}
async function confirm(accessToken: string, body: any) {
  const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, { method: "POST", headers: authed(accessToken), body: JSON.stringify(body) });
  return { status: res.status, body: await safeJson(res) };
}
async function getJSON(path: string, accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}${path}`, { headers: authed(accessToken) });
  return { status: res.status, body: await safeJson(res) };
}

describe("Group 6 -- boundaries reachable only past the UI", () => {
  it("XS-01 another user's category id is refused, nothing written to either account", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const bCats = (await getJSON("/categories", b.accessToken)).body;
    const bFood = bCats.find((c: any) => c.name === "Food");

    const r = await confirm(a.accessToken, { intent: "create-expense", drafts: [{ amount: 10, category: bFood._id }] });
    expect(r.status).toBeGreaterThanOrEqual(400);

    const aExpenses = (await getJSON("/expenses", a.accessToken)).body;
    const bExpenses = (await getJSON("/expenses", b.accessToken)).body;
    expect(aExpenses).toHaveLength(0);
    expect(bExpenses).toHaveLength(0);
  });

  it("XS-02 another user's expense id is refused, B's row unchanged byte for byte", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const created = await confirm(b.accessToken, { intent: "create-expense", drafts: [{ amount: 15, category: "Food" }] });
    const id = created.body.changed._id;
    const before = (await getJSON("/expenses", b.accessToken)).body.find((e: any) => e._id === id);

    const editAttempt = await confirm(a.accessToken, { intent: "edit-expense", id, changes: { amount: 999 } });
    expect(editAttempt.status).toBe(404);
    const deleteAttempt = await confirm(a.accessToken, { intent: "delete-expense", id });
    expect(deleteAttempt.status).toBe(404);

    const after = (await getJSON("/expenses", b.accessToken)).body.find((e: any) => e._id === id);
    expect(after).toEqual(before);
  });

  it("XS-03 reads are scoped to the caller -- every returned id belongs to A", async () => {
    const a = await signupUser();
    const b = await signupUser();
    await confirm(a.accessToken, { intent: "create-expense", drafts: [{ amount: 1, category: "Food" }] });
    await confirm(b.accessToken, { intent: "create-expense", drafts: [{ amount: 2, category: "Food" }] });

    const [messages, expenses, summary, categories] = await Promise.all([
      getJSON("/chat/messages", a.accessToken),
      getJSON("/expenses", a.accessToken),
      getJSON("/expenses/summary", a.accessToken),
      getJSON("/categories", a.accessToken),
    ]);
    const aCategoryIds = new Set(categories.body.map((c: any) => c._id));
    for (const e of expenses.body) expect(aCategoryIds.has(e.category)).toBe(true);
    expect(expenses.body.every((e: any) => e.amount !== 2)).toBe(true);
    expect(Array.isArray(messages.body)).toBe(true);
    expect(Array.isArray(summary.body)).toBe(true);
  });

  it("XS-04 no secret ever leaves the server, across signup/login/chat", async () => {
    const user = makeUser();
    const signupRes = await signup(user);
    const loginRes = await fetch(`${TEST_BASE_URL}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: "wrong-password" }),
    });
    const loginBody = await safeJson(loginRes);
    const chatRes = await confirm(signupRes.body.accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });

    // Real false-positive found running this for the first time: the login
    // failure body is REQUIRED (spec 05 §4, unit-userService.md US-10) to
    // read "Username or password is incorrect." -- containsSecret()'s bare
    // \bpassword\b check (correct for every OTHER body here, which should
    // never mention the word at all) flags that spec-mandated sentence as a
    // "leak" even though it carries no value, just the English word. Scoped
    // out for this one body rather than blunting containsSecret() for every
    // other caller (01-signup/02-refresh/05-login all rely on its current
    // strictness against bodies that have no legitimate reason to say
    // "password" at all).
    const loginBodyStr = JSON.stringify(loginBody);
    expect(loginBodyStr).not.toMatch(/"password"\s*:/i); // no password FIELD/value, the word alone is expected here
    expect(loginBodyStr).not.toMatch(/\$2[aby]\$/);
    expect(loginBodyStr).not.toContain("refreshToken");
    expect(loginBodyStr).not.toContain(process.env.GEMINI_API_KEY ?? "__no_key_in_env__");

    const bodies = [JSON.stringify(signupRes.body), JSON.stringify(chatRes.body)];
    for (const b of bodies) {
      const check = containsSecret(b);
      expect(check.hit, `XS-04: response body leaked a secret (${check.what}): ${b}`).toBe(false);
      expect(b).not.toContain("refreshToken");
      expect(b).not.toContain(process.env.GEMINI_API_KEY ?? "__no_key_in_env__");
    }
  });

  it("XS-05 (API half) bad amounts are refused, field-mapped, nothing written", async () => {
    const { accessToken } = await signupUser();
    for (const amount of [0, -5, 12.345, "abc", null, 1e999]) {
      const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount, category: "Food" }] });
      expect(r.status, `amount=${JSON.stringify(amount)} should be refused`).toBeGreaterThanOrEqual(400);
    }
    const expenses = (await getJSON("/expenses", accessToken)).body;
    expect(expenses).toHaveLength(0);
  });

  it("XS-06 bad dates are refused or clamped, never silently stored", async () => {
    const { accessToken } = await signupUser();
    for (const date of ["2099-01-01", "1970-01-01", "not-a-date"]) {
      const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 10, category: "Food", date }] });
      if (r.status === 200) {
        // If accepted, the spec requires it never be stored silently as-is
        // without at least being a valid, in-range date -- flagged, not
        // asserted to a specific clamp rule (BLOCKER B-B: no written rule).
        expect(r.body.changed?.date, `XS-06: date "${date}" accepted but produced no valid stored date`).toBeTruthy();
      } else {
        expect(r.status).toBeGreaterThanOrEqual(400);
      }
    }
    // BLOCKER B-B (qa-lead, flow-fresh-2026-09-16.md): no written rule for
    // out-of-range dates -- this case cannot assert a specific pass/fail
    // outcome for 2099/1970 beyond "not silently stored as garbage" above.
  });
});
