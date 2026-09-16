import { test, expect } from "@playwright/test";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

// Spec: qa/specs/e2e-chat-dashboard-journey.md.
// Governed by 01-ai-chat.md §6-7, 02-dashboard.md.
const E2E_PORT = 3100;
const API_BASE = `http://127.0.0.1:${E2E_PORT}`;

// FJ-01 -- the one place in this whole QA pass that calls the real Gemini API
// (one call, deliberately). Proves the actual chat -> draft -> confirm loop
// end to end through a real browser. Loose on AI wording, strict on structure.
test("FJ-01 type an expense in chat, confirm, it is really saved", async ({ page, context }) => {
  // Real network call to Gemini -- latency varies more than Playwright's
  // default 30s test timeout allows for reliably. The 45s `expect` timeout
  // below needs test-level headroom past it, or the test itself times out
  // first regardless of that setting.
  test.setTimeout(75_000);
  const user = makeUser();

  await page.goto("/signup");
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home$/);

  await page.getByLabel("Message").fill("spent 20 on coffee");
  await page.getByRole("button", { name: "Send" }).click();

  // Request one (real AI call) completed and returned something confirmable.
  // Generous timeout: this is a real network call to Gemini, latency varies.
  const confirmButton = page.getByRole("button", { name: "Confirm" });
  await expect(confirmButton).toBeVisible({ timeout: 45_000 });

  // The typed message and the AI's reply both landed in the thread.
  await expect(page.getByRole("listitem").filter({ hasText: "spent 20 on coffee" })).toBeVisible();

  await confirmButton.click();
  await expect(confirmButton).toHaveCount(0, { timeout: 10_000 });

  // Verify the save really happened server-side (not just optimistic UI),
  // using this browser session's own refresh cookie to get a fresh access token.
  const cookies = await context.cookies();
  const refreshCookie = cookies.find((c) => c.name === "refreshToken");
  expect(refreshCookie, "browser session must have a refreshToken cookie").toBeTruthy();
  const refreshRes = await fetch(`${API_BASE}/users/refresh`, {
    method: "POST",
    headers: { Cookie: `refreshToken=${refreshCookie!.value}` },
  });
  const { accessToken } = await safeJson(refreshRes);
  const expensesRes = await fetch(`${API_BASE}/expenses`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const expenses = await safeJson(expensesRes);
  expect(expenses.some((e: any) => e.amount === 20)).toBe(true);
});

// DJ-01 -- deterministic, no AI: seeds via POST /chat/confirm directly (same
// as CC-02), only drives the browser for the dashboard side.
test("DJ-01 expenses recorded via chat are reflected on the dashboard", async ({ page }) => {
  const signedUp = await signup(makeUser());
  const accessToken = signedUp.body.accessToken as string;

  async function confirmCreate(amount: number, category: string) {
    const res = await fetch(`${API_BASE}/chat/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "create-expense", drafts: [{ amount, category }] }),
    });
    expect(res.status).toBe(200);
  }
  await confirmCreate(30, "Food");
  await confirmCreate(20, "Transport");

  await page.goto("/login");
  await page.getByLabel("Username").fill(signedUp.user.username);
  await page.getByLabel("Password").fill(signedUp.user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/);

  // Client-side navigation via the real nav link, not page.goto -- a hard
  // browser navigation to a client-routed path is a different (and here,
  // unnecessary) thing to prove than "the app's own Dashboard link works".
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Per spec 02, with real recorded spend this period the empty state must
  // not show and the total must reflect it. The total figure appears twice
  // by design (top summary card + the category list's own total row), and
  // each category name appears twice too (the "By category" breakdown +
  // the "Recent expenses" table) -- so scope to the "By category" section
  // specifically. A bare text locator here is a strict-mode violation, not
  // a product bug.
  await expect(page.locator(".dashboard-totals__figure")).toHaveText("₪ 50.00", { timeout: 8_000 });
  const byCategory = page.getByRole("region", { name: "By category" });
  await expect(byCategory.getByText("Food")).toBeVisible();
  await expect(byCategory.getByText("Transport")).toBeVisible();
});
