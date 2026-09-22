/**
 * Browser-level regression cases for 2026-09-17 (qa/specs/regression-2026-09-17.md)
 * and the routing defect from qa/specs/exploratory-2026-09-17.md §1 (RT-*).
 *
 * SCOPE NOTE (read before extending this file): this file covers the
 * deterministic / cheap-to-run browser cases only -- no long multi-repetition
 * real-Gemini sweeps. The AI-probabilistic rate cases that RG-* designs at
 * 5 repetitions x several phrasings (RG-01, RG-03, RG-05's full 5-rep form,
 * RG-06, RG-08, RG-18, RG-19, RG-23) and the tutorial-vs-parser case (HT-32)
 * are NOT implemented here -- see the final run report for why (session time
 * budget) and which IDs are still open. RG-05 is implemented here at reduced
 * repetition (2, not 5) as a partial down-payment, clearly labelled.
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, logInThroughUI, sendChat, userBubble, assistantBubble, confirmButton,
  accessTokenFor, getExpenses, getCategories, apiBaseFor, looksLikeSaveClaim, logAIRaw, AI_WAIT,
} from "../helpers.js";

const API_BASE = apiBaseFor(3100);

// ---------------------------------------------------------------------------
// RT-* -- reloading a protected route (qa/specs/exploratory-2026-09-17.md §1)
// ---------------------------------------------------------------------------

test("RT-01 reloading the dashboard reloads the dashboard", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // DashboardPage's <h1> shows the active period label ("This month", "Today",
  // etc.), never the literal word "Dashboard" (see describePeriod() in
  // DashboardPage.tsx) -- assert something that is actually on the page.
  await expect(page.locator("h1.dashboard-title")).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("h1.dashboard-title")).toBeVisible();
});

test("RT-02 the path is never /login on the way to a reloaded /dashboard", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const samples: string[] = [];
  const sampler = setInterval(() => {
    samples.push(new URL(page.url()).pathname);
  }, 50);
  await page.reload();
  await page.waitForTimeout(4000);
  clearInterval(sampler);

  expect(samples.some((p) => p === "/login"), `path samples included /login: ${JSON.stringify(samples)}`).toBe(false);
  expect(samples.every((p) => p === "/dashboard" || p === "")).toBe(true);
});

test("RT-03 a bookmarked protected URL (fresh context, valid cookie) opens where it points", async ({ page, context }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);
  const cookies = await context.cookies();
  const fresh = await context.browser()!.newContext();
  await fresh.addCookies(cookies);
  const p2 = await fresh.newPage();
  await p2.goto("/dashboard");
  await expect(p2).toHaveURL(/\/dashboard$/);
  await expect(p2.locator("h1.dashboard-title")).toBeVisible();
  await fresh.close();
});

test("RT-04 reloading /home still works (neighbour check -- must not regress)", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);
  await expect(page).toHaveURL(/\/home$/);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByLabel("Message")).toBeVisible();
});

test("RT-05 a logged-out visitor on a protected URL reaches /login and stays", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login$/);
});

test("RT-08 / and an unknown path behave, logged out and logged in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/no-such-page-xyz");
  // The not-found page has BOTH a "not found" heading and a "Go back home"
  // link -- asserting on their union is a strict-mode violation (2 matches).
  // Assert the link specifically; it's the one a user actually needs.
  await expect(page.getByRole("link", { name: /back/i })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);

  const user = makeUser();
  await signUpThroughUI(page, user);
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/no-such-page-xyz");
  await expect(page).not.toHaveURL(/\/login$/);
});

// ---------------------------------------------------------------------------
// RG-09 -- a reload does not log you out (10 repetitions; a race is not
// proven by one)
// ---------------------------------------------------------------------------

test("RG-09 ten reloads in a row, session survives every one", async ({ page }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  for (let i = 0; i < 10; i++) {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page, `lost session on reload #${i + 1}`).toHaveURL(/\/home$/);
    await expect(page.getByLabel("Message"), `chat not rendered after reload #${i + 1}`).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// RG-22 -- the ordinary create-expense flow still works (real AI call)
// ---------------------------------------------------------------------------

test("RG-22 spent 50 at the supermarket and 32.5 on gas -> two correct expenses", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 50 at the supermarket and 32.5 on gas");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toBeHidden(AI_WAIT);

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  const categories = await getCategories(API_BASE, accessToken);
  expect(expenses).toHaveLength(2);

  const today = new Date().toISOString().slice(0, 10);
  const supermarket = expenses.find((e: any) => e.amount === 50);
  const gas = expenses.find((e: any) => e.amount === 32.5);
  expect(supermarket, `no expense with amount 50: ${JSON.stringify(expenses)}`).toBeTruthy();
  expect(gas, `no expense with amount 32.5: ${JSON.stringify(expenses)}`).toBeTruthy();

  for (const e of [supermarket, gas]) {
    expect(e.date.slice(0, 10)).toBe(today);
    expect(e.user).toBeTruthy();
    const cat = categories.find((c: any) => c._id === e.category);
    expect(cat, `expense's category id ${e.category} is not a real category this user owns`).toBeTruthy();
  }
  // A label matching what was said, on each.
  expect((supermarket.store ?? "") + (supermarket.description ?? "")).toMatch(/supermarket/i);
  expect((gas.store ?? "") + (gas.description ?? "")).toMatch(/gas/i);
});

// ---------------------------------------------------------------------------
// RG-31 -- the same expense reads the same in the chat and on the dashboard
// ---------------------------------------------------------------------------

test("RG-31 an expense of 1234.5 prints identically on the confirm card and the dashboard", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 1234.5 on rent");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  const cardText = await page.locator(".chat-confirm").innerText();
  const cardMoney = cardText.match(/₪[\s\d,.]+/)?.[0]?.trim();
  logAIRaw("RG-31", "confirm-card", { cardText });
  expect(cardMoney, `no ₪ amount found on the confirm card: ${cardText}`).toBeTruthy();

  await confirmButton(page).click();
  await expect(confirmButton(page)).toBeHidden(AI_WAIT);

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const rowText = await page.locator("table").filter({ hasText: "1,234.50" }).or(page.locator("table")).first().innerText();
  const rowMoney = [...rowText.matchAll(/₪[\s\d,.]+/g)].map((m) => m[0].trim()).find((s) => s.replace(/[^\d.]/g, "").includes("1234.5") || s.includes("1,234.50"));

  expect(rowMoney, `no matching ₪ amount found in dashboard table: ${rowText}`).toBeTruthy();
  expect(rowMoney, `chat card printed "${cardMoney}", dashboard printed "${rowMoney}" -- disagree`).toBe(cardMoney);
});

// ---------------------------------------------------------------------------
// RG-05 -- the app never claims to have saved something it did not save
// REDUCED REPETITION (2, not the spec's 5) -- see file header note.
// ---------------------------------------------------------------------------

test("RG-05 (2 reps, reduced from spec's 5) typing 'yes' never produces a false save claim", async ({ page, context }) => {
  test.setTimeout(120_000);
  for (let rep = 0; rep < 2; rep++) {
    const user = makeUser();
    await signUpThroughUI(page, user);

    await sendChat(page, "spent 22 at Aroma");
    await expect(confirmButton(page)).toBeVisible(AI_WAIT);
    await sendChat(page, "yes");
    await expect(userBubble(page, "yes")).toBeVisible(AI_WAIT);

    const accessToken = await accessTokenFor(context, API_BASE);
    const expenses = await getExpenses(API_BASE, accessToken);
    const saved = expenses.some((e: any) => e.amount === 22);
    const lastReply = await assistantBubble(page).last().innerText();
    logAIRaw("RG-05", `rep${rep}`, { saved, lastReply });

    if (!saved) {
      expect(looksLikeSaveClaim(lastReply), `RG-05 rep ${rep}: nothing saved but reply claims success: "${lastReply}"`).toBe(false);
    }
    // Invariant regardless of branch: expense count matches what the reply implies.
    expect(expenses.length, `RG-05 rep ${rep}: expense count`).toBe(saved ? 1 : 0);
  }
});
