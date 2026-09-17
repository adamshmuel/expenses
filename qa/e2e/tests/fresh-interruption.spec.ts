/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 8 (FR-32 .. FR-34).
 * FR-35 is API-only (a revoked-token replay is not reachable through the
 * UI) -- see qa/tests/api/13-fresh-split-halves.test.ts.
 * Environment: fresh account. BROWSER (headed).
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, sendChat, confirmButton, accessTokenFor, getExpenses, apiBaseFor, AI_WAIT,
} from "../helpers.js";

const API_BASE = apiBaseFor(3100);

test("FR-32 leaving mid-draft and coming back (dashboard, then /home)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 44 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Chat" }).click().catch(() => page.goto("/home"));
  await expect(page).toHaveURL(/\/home$/);

  const accessToken = await accessTokenFor(context, API_BASE);
  expect(await getExpenses(API_BASE, accessToken)).toHaveLength(0);

  const stillThere = (await confirmButton(page).count()) > 0;
  if (!stillThere) {
    const bubbles = await page.locator(".chat-bubble--assistant").allInnerTexts();
    expect(bubbles.some((t) => /lapsed|expired|no longer/i.test(t)), "FR-32: draft gone with no recorded lapse").toBe(
      true,
    );
  }
});

test("FR-33 reload while the save is in flight", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 55 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);

  // Delay the confirm response server-side (route interception at the
  // browser boundary -- the request still reaches the real server) so the
  // "reload before it returns" window is reliable rather than a race.
  await page.route("**/chat/confirm", async (route) => {
    await new Promise((r) => setTimeout(r, 3_000));
    await route.continue();
  });
  await confirmButton(page).click();
  await page.waitForTimeout(300);
  await page.reload();

  const accessToken = await accessTokenFor(context, API_BASE);
  await expect
    .poll(async () => (await getExpenses(API_BASE, accessToken)).length, { timeout: 8_000 })
    .toBeLessThanOrEqual(1);
  const expenses = await getExpenses(API_BASE, accessToken);
  expect([0, 1]).toContain(expenses.length);

  // C5: whichever it is, the transcript on reload should say which -- not
  // leave the user guessing.
  const bubbles = await page.locator(".chat-bubble--assistant").allInnerTexts();
  const saysSomethingDefinitive = bubbles.some((t) => /done|saved|confirm|failed|error|try again/i.test(t));
  expect(saysSomethingDefinitive, "FR-33: reload mid-save left no definitive record in the transcript").toBe(true);
});

test("FR-34 log out, log back in, carry on", async ({ page, context }) => {
  test.setTimeout(120_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 10 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  await sendChat(page, "spent 20 on lunch");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/);

  await expect(page.locator(".chat-bubble--user").filter({ hasText: "spent 10 on coffee" })).toBeVisible();
  await expect(page.locator(".chat-bubble--user").filter({ hasText: "spent 20 on lunch" })).toBeVisible();

  await sendChat(page, "spent 30 on gas");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(3);
  expect(expenses.map((e: any) => e.amount).sort((a: number, b: number) => a - b)).toEqual([10, 20, 30]);

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.locator(".dashboard-totals__figure")).toHaveText("₪ 60.00", { timeout: 8_000 });
});
