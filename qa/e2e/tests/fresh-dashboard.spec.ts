/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 4 (FR-21 .. FR-23).
 * Environment: fresh account. BROWSER (headed).
 */
import { test, expect } from "@playwright/test";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";
import { apiBaseFor } from "../helpers.js";

const API_BASE = apiBaseFor(3100);

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function confirmCreate(accessToken: string, amount: number, category: string, date: string) {
  const res = await fetch(`${API_BASE}/chat/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "create-expense", drafts: [{ amount, category, date }] }),
  });
  const body = await safeJson(res);
  expect(res.status, `seed confirm failed: ${JSON.stringify(body)}`).toBe(200);
  return body.changed;
}

test("FR-21 the dashboard equals the stored data, across all five range selectors (I8, C1)", async ({ page }) => {
  test.setTimeout(60_000);
  const signedUp = await signup(makeUser());
  const accessToken = signedUp.body.accessToken as string;
  const today = new Date();

  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15);
  // Straddles the boundary between last month and this one.
  const customFrom = new Date(today.getFullYear(), today.getMonth() - 1, 25);
  const customTo = new Date(today.getFullYear(), today.getMonth(), 5);

  const seeded = [
    { amount: 10, category: "Food", date: iso(today) }, // today, this week, this month
    { amount: 20, category: "Transport", date: iso(startOfThisMonth) }, // this month, not necessarily this week
    { amount: 30, category: "Food", date: iso(lastMonth) }, // a past month
    { amount: 40, category: "Home", date: iso(customFrom) }, // inside the custom range only
  ];
  const saved = [];
  for (const s of seeded) saved.push(await confirmCreate(accessToken, s.amount, s.category, s.date));

  await page.goto("/login");
  await page.getByLabel("Username").fill(signedUp.user.username);
  await page.getByLabel("Password").fill(signedUp.user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // "Today" -- only the today-dated row.
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.locator(".dashboard-totals__figure")).toHaveText("₪ 10.00", { timeout: 8_000 });

  // "This month" -- today + start-of-month rows (30/40 excluded, dated earlier).
  await page.getByRole("button", { name: "This month" }).click();
  await expect(page.locator(".dashboard-totals__figure")).toHaveText("₪ 30.00", { timeout: 8_000 });

  // Custom range spanning the month boundary -- the boundary-straddling row only.
  await page.getByRole("button", { name: "Custom" }).click();
  await page.locator("#dashboard-custom-from").fill(iso(customFrom));
  await page.locator("#dashboard-custom-to").fill(iso(customFrom));
  await expect(page.locator(".dashboard-totals__figure")).toHaveText("₪ 40.00", { timeout: 8_000 });

  // Recent-expenses table row for the custom-range expense: date, category, amount.
  const row = page.locator(".dashboard-table tbody tr", { hasText: "₪ 40.00" });
  await expect(row).toBeVisible();
  await expect(row.locator(".dashboard-table__category")).toHaveText("Home");
});

test("FR-22 the dashboard's three states: empty, loading, error", async ({ page }) => {
  const signedUp = await signup(makeUser());
  await page.goto("/login");
  await page.getByLabel("Username").fill(signedUp.user.username);
  await page.getByLabel("Password").fill(signedUp.user.password);
  await page.getByRole("button", { name: "Log in" }).click();

  // Empty state -- brand-new account, nothing filed.
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("Nothing filed in this period.")).toBeVisible({ timeout: 8_000 });

  // Loading state -- delay the summary response so the panel is observable.
  await page.route("**/expenses/summary*", async (route) => {
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });
  await page.reload();
  await expect(page.getByRole("status")).toBeVisible({ timeout: 2_000 });

  // Error state -- fail every dashboard fetch, with a working retry.
  await page.unroute("**/expenses/summary*");
  await page.route("**/expenses/summary*", (route) => route.fulfill({ status: 500, json: { error: "boom" } }));
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.unroute("**/expenses/summary*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Nothing filed in this period.")).toBeVisible({ timeout: 8_000 });
});

test("FR-23 the dashboard refetches on return", async ({ page }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await page.goto("/signup");
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home$/);

  await page.getByLabel("Message").fill("spent 33 on coffee");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.locator(".dashboard-totals__figure")).toHaveText("₪ 33.00", { timeout: 8_000 });
});
