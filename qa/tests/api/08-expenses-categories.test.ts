/**
 * API tests for GET /expenses, GET /expenses/summary, GET /categories
 * Test spec: qa/specs/api-expenses-categories.md  (ER-01 .. ER-09)
 * Governing spec: docs/specs/09-expense-category-service.md §5.
 *
 * Fixture expenses are seeded via POST /chat/confirm create-expense (real,
 * unaffected by the categoryModel.js bug found in int-categoryModel.md/
 * api-chat-confirm.md), against a signed-up user's default categories.
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
function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}
async function createExpense(accessToken: string, amount: number, category: string) {
  const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, {
    method: "POST",
    headers: { ...authHeader(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "create-expense", drafts: [{ amount, category }] }),
  });
  return (await safeJson(res)).changed;
}
async function getJson(path: string, accessToken?: string) {
  const res = await fetch(`${TEST_BASE_URL}${path}`, accessToken ? { headers: authHeader(accessToken) } : undefined);
  return { status: res.status, body: await safeJson(res) };
}

describe("GET /categories", () => {
  it("ER-01 no Authorization header -> 401", async () => {
    const r = await getJson("/categories");
    expect(r.status).toBe(401);
  });

  it("ER-02 returns only the logged-in user's categories", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const ra = await getJson("/categories", a.accessToken);
    const rb = await getJson("/categories", b.accessToken);
    expect(ra.body).toHaveLength(17);
    const idsA = new Set(ra.body.map((c: any) => c._id));
    const idsB = new Set(rb.body.map((c: any) => c._id));
    expect([...idsA].some((id) => idsB.has(id))).toBe(false);
  });
});

describe("GET /expenses", () => {
  it("ER-03 no Authorization header -> 401", async () => {
    const r = await getJson("/expenses");
    expect(r.status).toBe(401);
  });

  it("ER-04 narrows by date range (a range that excludes today)", async () => {
    const { accessToken } = await signupUser();
    await createExpense(accessToken, 10, "Food");
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dayAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await getJson(`/expenses?from=${tomorrow}&to=${dayAfter}`, accessToken);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("ER-10 narrowing with to=today still includes an expense created today", async () => {
    const { accessToken } = await signupUser();
    await createExpense(accessToken, 10, "Food");
    const today = new Date().toISOString().slice(0, 10);
    const r = await getJson(`/expenses?from=${today}&to=${today}`, accessToken);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it("ER-05 with no from/to returns everything for the user", async () => {
    const { accessToken } = await signupUser();
    await createExpense(accessToken, 10, "Food");
    await createExpense(accessToken, 20, "Transport");
    const r = await getJson("/expenses", accessToken);
    expect(r.body).toHaveLength(2);
  });

  it("ER-06 scoped to the logged-in user only", async () => {
    const a = await signupUser();
    const b = await signupUser();
    await createExpense(a.accessToken, 10, "Food");
    await createExpense(a.accessToken, 20, "Food");
    const bExp = await createExpense(b.accessToken, 30, "Food");
    const r = await getJson("/expenses", a.accessToken);
    expect(r.body).toHaveLength(2);
    expect(r.body.some((e: any) => e._id === bExp._id)).toBe(false);
  });
});

describe("GET /expenses/summary", () => {
  it("ER-07 no Authorization header -> 401", async () => {
    const r = await getJson("/expenses/summary");
    expect(r.status).toBe(401);
  });

  it("ER-08 totals match what was actually saved -- FINDING: getExpenseTotalByCategory never matches (string userId vs ObjectId)", async () => {
    const { accessToken } = await signupUser();
    await createExpense(accessToken, 10, "Food");
    await createExpense(accessToken, 15, "Food");
    await createExpense(accessToken, 7, "Transport");
    const categories = await getJson("/categories", accessToken);
    const food = categories.body.find((c: any) => c.name === "Food");
    const transport = categories.body.find((c: any) => c.name === "Transport");

    const r = await getJson("/expenses/summary", accessToken);
    const byId = new Map(r.body.map((row: any) => [row._id, row.total]));
    expect(byId.get(food._id)).toBe(25);
    expect(byId.get(transport._id)).toBe(7);
  });

  it("ER-09 scoped to the logged-in user only -- FINDING: masked by the same bug, totals are 0 either way", async () => {
    const a = await signupUser();
    const b = await signupUser();
    await createExpense(a.accessToken, 5, "Food");
    await createExpense(b.accessToken, 100, "Food");
    const r = await getJson("/expenses/summary", a.accessToken);
    const total = r.body.reduce((sum: number, row: any) => sum + row.total, 0);
    expect(total).toBe(5);
  });

  it("ER-11 with to=today still includes an expense created today", async () => {
    const { accessToken } = await signupUser();
    await createExpense(accessToken, 10, "Food");
    const today = new Date().toISOString().slice(0, 10);
    const r = await getJson(`/expenses/summary?from=${today}&to=${today}`, accessToken);
    const total = r.body.reduce((sum: number, row: any) => sum + row.total, 0);
    expect(total).toBe(10);
  });
});
