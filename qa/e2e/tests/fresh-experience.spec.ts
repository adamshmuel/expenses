/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 11 (FR-41 .. FR-44).
 * FR-43's language bar is PROVISIONAL (qa/harness/bars.ts LANGUAGE_MATCH_BAR_ACTIVE)
 * -- if Adam rejects it, delete this test, don't weaken it.
 * Environment: fresh account. BROWSER (headed).
 */
import { test, expect } from "@playwright/test";
import { makeUser, signUpThroughUI, sendChat, confirmButton, AI_WAIT } from "../helpers.js";
import { LANGUAGE_MATCH_BAR_ACTIVE } from "../../harness/bars.js";

test("FR-41 every question the app asks can be answered", async ({ page }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  const messages = ["bought coffee", "delete the helicopter expense", "add a category called X under Y"];
  for (const msg of messages) {
    await sendChat(page, msg);
    await expect(page.locator(".chat-bubble--user").filter({ hasText: msg })).toBeVisible(AI_WAIT);
    const lastReply = await page.locator(".chat-bubble--assistant").last().innerText();
    if (lastReply.trim().endsWith("?")) {
      const hasControl = (await confirmButton(page).count()) > 0 || (await page.locator(".chat-matches button").count()) > 0;
      // Understood by typing an answer is the alternative -- exercised
      // elsewhere (FR-09/FR-30); here we require at least one route to exist.
      expect(
        hasControl,
        `FR-41: assistant asked "${lastReply}" with no on-screen control to answer it`,
      ).toBe(true);
    }
    if (await confirmButton(page).count()) await confirmButton(page).click();
    await page.waitForTimeout(200);
  }
});

test("FR-42 a refusal points somewhere useful", async ({ page }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "how much did I spend on food this month?");
  await expect(page.locator(".chat-bubble--user").filter({ hasText: "how much did I spend" })).toBeVisible(AI_WAIT);
  const reply = await page.locator(".chat-bubble--assistant").last().innerText();
  expect(/dashboard/i.test(reply), `FR-42: refusal does not point at the dashboard: "${reply}"`).toBe(true);
});

test("FR-43 [PROVISIONAL BAR] the app answers in the language it was written to", async ({ page }) => {
  test.skip(!LANGUAGE_MATCH_BAR_ACTIVE, "FR-43 bar not yet confirmed by Adam");
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "קניתי קפה ב-15 שקל");
  await expect(page.locator(".chat-bubble--user").filter({ hasText: "קניתי קפה" })).toBeVisible(AI_WAIT);
  const hebrewReply = await page.locator(".chat-bubble--assistant").last().innerText();
  const isHebrew = /[֐-׿]/.test(hebrewReply);
  expect(isHebrew, `FR-43: Hebrew message got a non-Hebrew reply: "${hebrewReply}"`).toBe(true);

  await sendChat(page, "spent 15 on coffee");
  await expect(page.locator(".chat-bubble--user").filter({ hasText: "spent 15 on coffee" })).toBeVisible(AI_WAIT);
  const englishReply = await page.locator(".chat-bubble--assistant").last().innerText();
  expect(/[֐-׿]/.test(englishReply)).toBe(false);
});

test("FR-44 the confirmed expense stays readable in the transcript", async ({ page }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 12 on coffee and 8 on the bus");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  await page.locator(".chat-scroll").evaluate((el) => el.scrollTo({ top: 0 }));
  await page.reload();
  await page.locator(".chat-scroll").evaluate((el) => el.scrollTo({ top: 0 }));

  const transcriptText = await page.locator(".chat-thread").innerText();
  expect(
    /12|coffee/i.test(transcriptText) && /8|bus/i.test(transcriptText),
    `FR-44: after reload, the transcript no longer shows what was saved: "${transcriptText}"`,
  ).toBe(true);
});
