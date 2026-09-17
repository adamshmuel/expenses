/**
 * API tests for POST /chat/confirm's category-resolution failure shapes and
 * the confirm audit trail (success and failure).
 * Test spec: qa/specs/api-chat-confirm-resolution.md  (CR-01 .. CR-08)
 * Governing spec: docs/specs/09-expense-category-service.md §2-§4;
 * 01-ai-chat.md §6-§7.
 *
 * Why this file exists (not folded into 06-chat-confirm.test.ts): every case
 * in that file sends a complete, valid payload. Bug 1 (undefined category
 * name crashes findByName) and bug 9 (create-category parent name vs id
 * contract mismatch) both slipped through exactly because "the one shape
 * that crashes was the one shape untested" -- see
 * docs/reference/testing-reference/2026-09-16-manual-bugs-found.md and
 * 2026-09-16-chat-flow-bugs-and-fixes.md. This file is the incomplete-input
 * counterpart, plus field-level assertions on the messages collection
 * (Finding A in the manual-bugs file).
 *
 * Real HTTP against the spawned server (harness/globalSetup.ts) on :3100,
 * real Mongo. /chat/confirm never calls backend/ai/, so every case here is
 * deterministic, no Gemini call.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

useServer();

async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string, userId: r.body.user.id as string };
}

function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

async function confirm(accessToken: string, body: any) {
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

async function getMessages(accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}/chat/messages`, { headers: authed(accessToken) });
  return safeJson(res);
}

describe("POST /chat/confirm -- category resolution failures", () => {
  it("CR-01 missing category on create-expense -> 400, nothing saved, exact history line", async () => {
    const { accessToken, userId } = await signupUser();
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 10 }] });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "Which category should this go under?" });

    expect(await getExpenses(accessToken)).toHaveLength(0);

    const messages = await getMessages(accessToken);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].author).toBe(userId);
    expect(messages[0].text).toBe("Which category should this go under?");
  });

  it("CR-02 empty-string category -> the same 400 as CR-01, nothing saved", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 10, category: "" }] });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "Which category should this go under?" });
    expect(await getExpenses(accessToken)).toHaveLength(0);
  });

  it("CR-03 a category name that doesn't exist -> 400 'Create it first?', nothing saved", async () => {
    const { accessToken, userId } = await signupUser();
    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [{ amount: 10, category: "Spaceship Fuel" }],
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'No category named "Spaceship Fuel". Create it first?' });
    expect(await getExpenses(accessToken)).toHaveLength(0);

    const messages = await getMessages(accessToken);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      author: userId,
      text: 'No category named "Spaceship Fuel". Create it first?',
    });
  });

  it("CR-04 an ambiguous category name (2+ matches) -> 400 with candidates, nothing saved", async () => {
    const { accessToken } = await signupUser();
    // "Misc" as a main category, and "Misc" again as a subcategory of a
    // different main -- findByName(userId, "Misc") with no parentId matches
    // both, since it only scopes by parent when one is given.
    const mainMisc = await confirm(accessToken, { intent: "create-category", draft: { name: "Misc" } });
    expect(mainMisc.status).toBe(200);
    const subMisc = await confirm(accessToken, {
      intent: "create-category",
      draft: { name: "Misc", parent: "Transport" },
    });
    expect(subMisc.status).toBe(200);

    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 10, category: "Misc" }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^More than one category matches/);
    expect(await getExpenses(accessToken)).toHaveLength(0);
  });

  it("CR-05 a batch with one bad category fails the whole batch, no partial save", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [
        { amount: 5, category: "Food" },
        { amount: 6, category: "Nonexistent" },
      ],
    });
    expect(r.status).toBe(400);
    // The valid first draft must not have been saved on its own.
    expect(await getExpenses(accessToken)).toHaveLength(0);
  });

  it("CR-06 a successful confirm's 'Done.' message is the full, correct record", async () => {
    const { accessToken, userId } = await signupUser();
    const before = Date.now();
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });
    expect(r.status).toBe(200);

    const messages = await getMessages(accessToken);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].author).toBe(userId);
    expect(messages[0].text).toBe("Done.");
    expect(new Date(messages[0].createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("CR-07 create-category resolves a name-based parent to a real id, not the string (bug 9 regression)", async () => {
    const { accessToken } = await signupUser();
    const categories = await getCategories(accessToken);
    const transport = categories.find((c: any) => c.name === "Transport");
    expect(transport).toBeTruthy();

    const r = await confirm(accessToken, { intent: "create-category", draft: { name: "Bike", parent: "Transport" } });
    expect(r.status).toBe(200);
    expect(r.body.changed.name).toBe("Bike");
    expect(r.body.changed.parent).toBe(transport._id);
    expect(r.body.changed.parent).not.toBe("Transport");
  });

  it("CR-08 create-category with a nonexistent parent name -> 400, nothing saved", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, { intent: "create-category", draft: { name: "Bike", parent: "Spaceships" } });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "No such category to add a subcategory to." });

    const categories = await getCategories(accessToken);
    expect(categories.some((c: any) => c.name === "Bike")).toBe(false);
  });
});
