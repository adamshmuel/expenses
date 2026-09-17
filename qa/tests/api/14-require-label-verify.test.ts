/**
 * One-off verification of the requireLabel bug fix in backend/bl/expenseService.js
 * (an expense could previously be saved with neither `store` nor `description`,
 * showing up as a permanent blank row on the dashboard).
 *
 * Scope: narrowly the 7 checks Adam asked to confirm, across all three call sites
 * (createExpense, createManyExpenses, editExpense). Not a new designed test-spec
 * area, not added to qa/test-roadmap.md, per the task's instructions.
 *
 * Driven through the real path: POST /chat/confirm (the only route that reaches
 * these service functions -- there is no direct POST/PATCH /expenses route).
 * Real running server (qa/harness/useServer.ts) against the isolated
 * expenses_qa_test database. DB assertions via qa/harness/db.ts.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { testDb } from "../../harness/db.js";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";
import mongoose from "mongoose";

useServer();

async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string, userId: r.body.user.id as string };
}
function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}
async function confirm(accessToken: string, payload: object) {
  const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, {
    method: "POST",
    headers: authHeader(accessToken),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await safeJson(res) };
}
// createExpense/createManyExpenses/editExpense resolve `category` by NAME
// (categoryService.findByName), matching what the AI parser normally sends and
// the convention in tests/api/08-expenses-categories.test.ts. Every signed-up
// user gets this default category set, so "Food" always resolves.
const CATEGORY = "Food";

// db.collection() is the native MongoDB driver, not Mongoose -- it does not
// auto-cast a string to ObjectId the way a Mongoose query would, and the
// Expense schema stores `user` as an ObjectId (backend/models/expenseModel.js).
async function countExpensesForUser(userId: string) {
  const db = await testDb();
  return db.collection("expenses").countDocuments({ user: new mongoose.Types.ObjectId(userId) });
}

describe("requireLabel fix -- createExpense (chat/confirm create-expense, single draft)", () => {
  it("check 1: both store and description omitted -> 400, nothing written", async () => {
    const { accessToken, userId } = await signupUser();
    const category = CATEGORY;
    const before = await countExpensesForUser(userId);

    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [{ amount: 10, category }],
    });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("An expense needs a store or a description.");
    const after = await countExpensesForUser(userId);
    expect(after).toBe(before);
  });

  it("check 2: only store set -> success, saved", async () => {
    const { accessToken, userId } = await signupUser();
    const category = CATEGORY;

    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [{ amount: 10, store: "Corner Shop", category }],
    });

    expect([200, 201]).toContain(r.status);
    expect(r.body.changed.store).toBe("Corner Shop");
    expect(await countExpensesForUser(userId)).toBe(1);
  });

  it("check 3: only description set -> success, saved", async () => {
    const { accessToken, userId } = await signupUser();
    const category = CATEGORY;

    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [{ amount: 10, description: "Coffee with a friend", category }],
    });

    expect([200, 201]).toContain(r.status);
    expect(r.body.changed.description).toBe("Coffee with a friend");
    expect(await countExpensesForUser(userId)).toBe(1);
  });
});

describe("requireLabel fix -- createManyExpenses (chat/confirm create-expense, batch)", () => {
  it("check 4: one bad draft among good ones -> 400, all-or-nothing (none written)", async () => {
    const { accessToken, userId } = await signupUser();
    const category = CATEGORY;

    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [
        { amount: 10, store: "Good Store A", category },
        { amount: 20, category }, // neither store nor description
        { amount: 30, description: "Good description C", category },
      ],
    });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("An expense needs a store or a description.");
    expect(await countExpensesForUser(userId)).toBe(0);
  });
});

describe("requireLabel fix -- editExpense (chat/confirm edit-expense)", () => {
  async function createLabelledExpense(accessToken: string, category: string) {
    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [{ amount: 50, store: "Original Store", category }],
    });
    return r.body.changed._id as string;
  }

  it("check 5: editing only amount (not touching store/description) -> success", async () => {
    const { accessToken } = await signupUser();
    const category = CATEGORY;
    const id = await createLabelledExpense(accessToken, category);

    const r = await confirm(accessToken, {
      intent: "edit-expense",
      id,
      changes: { amount: 99 },
    });

    expect(r.status).toBe(200);
    expect(r.body.changed.amount).toBe(99);
  });

  it("check 6: clearing both store and description -> 400, existing label not wiped in DB", async () => {
    const { accessToken } = await signupUser();
    const category = CATEGORY;
    const id = await createLabelledExpense(accessToken, category);

    const r = await confirm(accessToken, {
      intent: "edit-expense",
      id,
      changes: { store: "", description: "" },
    });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("An expense needs a store or a description.");

    const db = await testDb();
    const doc = await db.collection("expenses").findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(doc?.store).toBe("Original Store");
  });

  it("check 7: setting store while description stays untouched -> success (fallback satisfies the rule)", async () => {
    const { accessToken } = await signupUser();
    const category = CATEGORY;
    const id = await createLabelledExpense(accessToken, category);

    const r = await confirm(accessToken, {
      intent: "edit-expense",
      id,
      changes: { store: "New Store Name" },
    });

    expect(r.status).toBe(200);
    expect(r.body.changed.store).toBe("New Store Name");
  });
});
