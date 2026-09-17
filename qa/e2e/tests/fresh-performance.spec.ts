/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 9 (FR-36 .. FR-37).
 * PROVISIONAL BAR -- qa-lead's proposal, not yet confirmed by Adam (see
 * qa/harness/bars.ts, the single place these numbers live). Every assertion
 * here is labelled "provisional bar" in the run report.
 * Environment: fresh account. BROWSER (headed).
 */
import { test, expect } from "@playwright/test";
import { makeUser, signUpThroughUI, sendChat, confirmButton } from "../helpers.js";
import { RESPONSE_BUDGET_MS } from "../../harness/bars.js";

test("FR-36 [PROVISIONAL BAR] the screens meet the response budget (3 runs, worst kept)", async ({ page }) => {
  test.setTimeout(120_000);
  const user = makeUser();

  const navTimes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await page.goto("/signup");
    await page.getByLabel("Username", { exact: true }).waitFor({ state: "visible" });
    navTimes.push(Date.now() - start);
    if (i < 2) await page.goto("about:blank");
  }
  const worstNav = Math.max(...navTimes);
  expect(worstNav, `FR-36 [provisional]: /signup usable after nav in ${worstNav}ms`).toBeLessThan(
    RESPONSE_BUDGET_MS.screenUsableAfterNav,
  );

  await signUpThroughUI(page, user);
  const dashStart = Date.now();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByText("Nothing filed in this period.").waitFor({ state: "visible" });
  const dashTime = Date.now() - dashStart;
  expect(dashTime, `FR-36 [provisional]: dashboard render took ${dashTime}ms`).toBeLessThan(
    RESPONSE_BUDGET_MS.dashboardRendersFresh,
  );

  await page.getByRole("link", { name: "Chat" }).click().catch(() => page.goto("/home"));
  await sendChat(page, "spent 5 on coffee");
  await confirmButton(page).waitFor({ state: "visible", timeout: 45_000 });
  const confirmStart = Date.now();
  await confirmButton(page).click();
  await confirmButton(page).waitFor({ state: "detached", timeout: 10_000 });
  const confirmTime = Date.now() - confirmStart;
  expect(confirmTime, `FR-36 [provisional]: confirm took ${confirmTime}ms`).toBeLessThan(
    RESPONSE_BUDGET_MS.confirmCompletes,
  );
});

test("FR-37 [PROVISIONAL BAR] work in progress is always visible within 300ms", async ({ page }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await page.route("**/chat/messages", async (route) => {
    await new Promise((r) => setTimeout(r, 5_000));
    await route.continue();
  });

  const sendButton = page.getByRole("button", { name: /Send|Sending/ });
  await page.getByLabel("Message").fill("spent 5 on coffee");
  const clickTime = Date.now();
  await sendButton.click();

  await expect
    .poll(
      async () => {
        const isDisabled = await sendButton.isDisabled();
        const text = await sendButton.innerText();
        return isDisabled || /sending/i.test(text);
      },
      { timeout: RESPONSE_BUDGET_MS.visibleFeedback + 200, intervals: [20] },
    )
    .toBe(true);
  const feedbackTime = Date.now() - clickTime;
  expect(feedbackTime, `FR-37 [provisional]: visible feedback took ${feedbackTime}ms`).toBeLessThan(
    RESPONSE_BUDGET_MS.visibleFeedback + 200, // small allowance for polling granularity
  );
});
