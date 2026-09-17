/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 3 (FR-16 .. FR-20).
 * Environment: fresh account. BROWSER (headed) except FR-20's API half
 * (qa/tests/api/13-fresh-split-halves.test.ts) and FR-35 (API only, Group 8).
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, sendChat, confirmButton, apiBaseFor,
} from "../helpers.js";

test("FR-16 /users/refresh is called exactly once on start-up", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);

  let refreshCalls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/users/refresh") && r.method() === "POST") refreshCalls++;
  });
  await page.reload();
  await page.waitForLoadState("networkidle");

  expect(refreshCalls, "FR-16: /users/refresh must fire exactly once on start-up (spec 03-api-contract.md)").toBe(1);
});

test("FR-17 a reload keeps the session, 5 repeats (a race proves nothing on one pass)", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);

  for (let i = 0; i < 5; i++) {
    await page.reload();
    await expect(page).toHaveURL(/\/home$/, { timeout: 5_000 });
    await expect(page.getByText(user.username)).toBeVisible({ timeout: 5_000 });
  }
});

test("FR-18 two tabs stay logged in", async ({ page, context }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);

  const page2 = await context.newPage();
  await page2.goto("/home");
  await expect(page2).toHaveURL(/\/home$/);

  await page.reload();
  await page2.reload();

  await expect(page).toHaveURL(/\/home$/, { timeout: 5_000 });
  await expect(page2).toHaveURL(/\/home$/, { timeout: 5_000 });
  await page2.close();
});

test("FR-19 a pending draft survives a reload, or says it did not", async ({ page }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 27 on coffee");
  await expect(confirmButton(page)).toBeVisible({ timeout: 45_000 });
  await page.reload();

  const stillConfirmable = (await confirmButton(page).count()) > 0;
  if (!stillConfirmable) {
    const bubbles = await page.locator(".chat-bubble--assistant").allInnerTexts();
    const recordsLapse = bubbles.some((t) => /lapsed|expired|no longer|start again|lost/i.test(t));
    expect(
      recordsLapse,
      "FR-19: the draft did not survive the reload, and nothing in the transcript records that it lapsed",
    ).toBe(true);
  }
});

test("FR-20 (browser half) the AI call failing does not lose the user's text", async ({ page }) => {
  test.setTimeout(30_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  // Intercept at the browser network boundary to simulate backend/ai/
  // returning a 502 -- we cannot inject a fault inside backend/ai/ itself
  // without writing to backend/, so this is the closest honest substitute
  // for "force a 502 from backend/ai/" reachable from the client side.
  await page.route("**/chat/messages", (route) => route.fulfill({ status: 502, json: { error: "Bad gateway" } }));

  const typedText = "spent 40 on a very specific thing";
  await page.getByLabel("Message").fill(typedText);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  // Spec 01-ai-chat.md §7: the user's text is not lost.
  await expect(page.getByLabel("Message")).toHaveValue(typedText);
});
