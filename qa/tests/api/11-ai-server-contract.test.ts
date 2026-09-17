/**
 * API test: qa/specs/flow-fresh-2026-09-16.md BD-02 -- the AI<->server
 * contract, over all seven intent shapes. No live model needed (per the
 * case's own note): `backend/ai/schema.js` declares the shape the model
 * must return; this file sends /chat/confirm exactly those shapes (as a
 * real client echoing a real AI reply would) and asserts the consuming
 * service (bl/expenseService.js, bl/categoryService.js via routes/chatRoute.js)
 * accepts every field, by name and by type -- especially every field that is
 * a NAME on the AI side and an ObjectId on the server side (bug 9's class).
 * Layer: API -- a contract check over shapes, no screen involved.
 * Environment: fresh.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

useServer();

async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string };
}
function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}
async function confirm(accessToken: string, body: any) {
  const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, { method: "POST", headers: authed(accessToken), body: JSON.stringify(body) });
  return { status: res.status, body: await safeJson(res) };
}
async function categories(accessToken: string) {
  const res = await fetch(`${TEST_BASE_URL}/categories`, { headers: authed(accessToken) });
  return safeJson(res);
}

describe("BD-02 -- AI<->server contract over the seven intent shapes", () => {
  it("create-expense: schema's {amount:number, store, description, date:'YYYY-MM-DD', category:name} is fully accepted", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, {
      intent: "create-expense",
      drafts: [{ amount: 12.5, store: "Aroma", description: "morning coffee", date: "2026-08-01", category: "Food" }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.changed.category).toMatch(/^[a-f0-9]{24}$/i); // name resolved to a real ObjectId
    expect(r.body.changed.date.slice(0, 10)).toBe("2026-08-01");
  });

  it("edit-expense: changes{amount, store, description, date, category:name} all accepted; category resolves to an id", async () => {
    const { accessToken } = await signupUser();
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });
    const id = created.body.changed._id;
    const cats = await categories(accessToken);
    const transport = cats.find((c: any) => c.name === "Transport");

    const r = await confirm(accessToken, {
      intent: "edit-expense",
      id,
      changes: { amount: 9, store: "New store", description: "new desc", date: "2026-08-02", category: "Transport" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.changed.category).toBe(transport._id); // NAME on the AI side, ObjectId on the server -- bug 9's exact seam
  });

  it("create-category: draft{name, parent:name-or-null} accepted; parent resolves to an id, never stored as a name", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, { intent: "create-category", draft: { name: "Puzzles", parent: "Entertainment" } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const cats = await categories(accessToken);
    const entertainment = cats.find((c: any) => c.name === "Entertainment");
    expect(r.body.changed.parent).toBe(entertainment._id);
    expect(r.body.changed.parent).not.toBe("Entertainment");
  });

  it("edit-category: changes{name} is the field the schema declares for a rename, and it is accepted", async () => {
    const { accessToken } = await signupUser();
    const cats = await categories(accessToken);
    const food = cats.find((c: any) => c.name === "Food");
    const r = await confirm(accessToken, { intent: "edit-category", id: food._id, changes: { name: "Groceries & food" } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.changed.name).toBe("Groceries & food");
  });

  it("delete-expense / delete-category: only an id is required, matching the schema (no drafts/changes needed)", async () => {
    const { accessToken } = await signupUser();
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, category: "Food" }] });
    const del1 = await confirm(accessToken, { intent: "delete-expense", id: created.body.changed._id });
    expect(del1.status).toBe(200);

    const cats = await categories(accessToken);
    const health = cats.find((c: any) => c.name === "Health");
    const del2 = await confirm(accessToken, { intent: "delete-category", id: health._id });
    expect(del2.status).toBe(200);
  });

  it("reset-categories: takes no fields at all, matching the schema (no drafts/changes/draft required)", async () => {
    const { accessToken } = await signupUser();
    const r = await confirm(accessToken, { intent: "reset-categories" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
