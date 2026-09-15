/**
 * API tests for POST /chat/confirm
 * Test spec: qa/specs/api-chat-confirm.md  (CC-01 .. CC-12)
 * Governing spec: docs/specs/09-expense-category-service.md §4; 01-ai-chat.md §6.
 *
 * Real HTTP against the spawned server (harness/globalSetup.ts) on :3100,
 * real Mongo. /chat/confirm never calls backend/ai/, so every case here is
 * testable without a real Gemini call.
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

async function getCategories(accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}/categories`, { headers: authed(accessToken) });
  return safeJson(res);
}

async function getExpenses(accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}/expenses`, { headers: authed(accessToken) });
  return safeJson(res);
}

describe("POST /chat/confirm", () => {
  it("CC-01 no Authorization header -> 401", async () => {
    const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "create-expense", drafts: [{ amount: 1, category: "Food" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("CC-02 create-expense with a single draft saves one expense", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [{ amount: 12.5, store: "Aroma", category: "Food" }],
    });
    expect(r.status).toBe(200);
    expect(r.body.changed.amount).toBe(12.5);

    const expenses = await getExpenses(accessToken);
    expect(expenses.some((e: any) => e._id === r.body.changed._id)).toBe(true);
  });

  it("CC-03 create-expense with drafts.length > 1 uses the batch path", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [
        { amount: 1, category: "Food" },
        { amount: 2, category: "Food" },
      ],
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.changed)).toBe(true);
    expect(r.body.changed).toHaveLength(2);

    const expenses = await getExpenses(accessToken);
    expect(expenses).toHaveLength(2);
  });

  it("CC-04 edit-expense updates the named field", async () => {
    const { accessToken } = await signupUser();
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });
    const id = created.body.changed._id;

    const edited = await confirm(accessToken, { intent: "edit-expense", id, changes: { amount: 99 } });
    expect(edited.status).toBe(200);
    expect(edited.body.changed.amount).toBe(99);
  });

  it("CC-05 edit-expense with changes.category (a name) moves the expense", async () => {
    const { accessToken } = await signupUser();
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });
    const id = created.body.changed._id;

    const categories = await getCategories(accessToken);
    const transport = categories.find((c: any) => c.name === "Transport");

    const edited = await confirm(accessToken, { intent: "edit-expense", id, changes: { category: "Transport" } });
    expect(edited.status).toBe(200);
    expect(edited.body.changed.category).toBe(transport._id);
  });

  it("CC-06 delete-expense removes it", async () => {
    const { accessToken } = await signupUser();
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });
    const id = created.body.changed._id;

    const deleted = await confirm(accessToken, { intent: "delete-expense", id });
    expect(deleted.status).toBe(200);

    const expenses = await getExpenses(accessToken);
    expect(expenses.some((e: any) => e._id === id)).toBe(false);
  });

  it("CC-07 edit/delete on someone else's expense id -> 404", async () => {
    const userA = await signupUser();
    const userB = await signupUser();
    const created = await confirm(userA.accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });
    const id = created.body.changed._id;

    const r = await confirm(userB.accessToken, { intent: "delete-expense", id });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "Expense not found." });

    const expensesA = await getExpenses(userA.accessToken);
    expect(expensesA.some((e: any) => e._id === id)).toBe(true);
  });

  it("CC-08 create-category saves a new main category", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, { intent: "create-category", draft: { name: "Pets" } });
    expect(r.status).toBe(200);
    expect(r.body.changed.name).toBe("Pets");
    expect(r.body.changed._id).toBeTruthy();

    const categories = await getCategories(accessToken);
    expect(categories.some((c: any) => c._id === r.body.changed._id)).toBe(true);
  });

  it("CC-09 edit-category renames it", async () => {
    const { accessToken } = await signupUser();
    const categories = await getCategories(accessToken);
    const food = categories.find((c: any) => c.name === "Food");
    const r = await confirm(accessToken, { intent: "edit-category", id: food._id, changes: { name: "Renamed" } });
    expect(r.status).toBe(200);
    expect(r.body.changed.name).toBe("Renamed");
  });

  it("CC-10 delete-category removes it and reassigns its expenses to Other", async () => {
    const { accessToken } = await signupUser();
    const categories = await getCategories(accessToken);
    const food = categories.find((c: any) => c.name === "Food");
    const other = categories.find((c: any) => c.name === "Other");
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });

    const r = await confirm(accessToken, { intent: "delete-category", id: food._id });
    expect(r.status).toBe(200);

    const remaining = await getCategories(accessToken);
    expect(remaining.some((c: any) => c._id === food._id)).toBe(false);

    const expenses = await getExpenses(accessToken);
    const moved = expenses.find((e: any) => e._id === created.body.changed._id);
    expect(moved.category).toBe(other._id);
  });

  it("CC-11 reset-categories wipes and reseeds, and existing expenses land on the new Other", async () => {
    const { accessToken } = await signupUser();
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });

    const r = await confirm(accessToken, { intent: "reset-categories" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.changed)).toBe(true);
    expect(r.body.changed.length).toBeGreaterThan(0);

    const newOther = r.body.changed.find((c: any) => c.name === "Other");
    expect(newOther).toBeTruthy();

    const expenses = await getExpenses(accessToken);
    const moved = expenses.find((e: any) => e._id === created.body.changed._id);
    expect(moved.category).toBe(newOther._id);
  });

  it("CC-12 an unrecognized intent falls through the switch, still 200 with no 'changed' payload", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, { intent: "not-a-real-intent" });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBeUndefined();
  });
});
