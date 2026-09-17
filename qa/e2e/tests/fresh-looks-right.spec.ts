/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 10 (FR-38 .. FR-40).
 * PROVISIONAL BAR -- the seven "looks right" rules are qa-lead's proposal,
 * not yet confirmed by Adam (qa/harness/bars.ts is the single place the
 * widths/touch-target number live). FR-40 is a structural, not pixel,
 * comparison against docs/designs/Expenses Redesign.dc.html.
 * Environment: fresh account. BROWSER (headed).
 */
import { test, expect, type Page } from "@playwright/test";
import { makeUser, signUpThroughUI } from "../helpers.js";
import { LOOKS_RIGHT } from "../../harness/bars.js";

async function hasHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** Rule 3: every reachable control is at least 44x44 CSS px. Only visible,
 *  rendered elements count (zero-size or display:none nodes are template
 *  artifacts, not something a finger can miss). */
async function undersizedTouchTargets(page: Page, minPx: number): Promise<string[]> {
  return page.evaluate((min) => {
    const nodes = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]');
    const findings: string[] = [];
    nodes.forEach((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return; // not actually rendered
      if (rect.width < min || rect.height < min) {
        const label = (el as HTMLElement).textContent?.trim().slice(0, 30) || (el as HTMLElement).getAttribute("aria-label") || "";
        findings.push(`${el.tagName.toLowerCase()} "${label}" is ${Math.round(rect.width)}x${Math.round(rect.height)}px`);
      }
    });
    return findings;
  }, minPx);
}

const ROUTES = ["/signup", "/login", "/home", "/dashboard", "/this-route-does-not-exist"];

test("FR-38 [PROVISIONAL BAR] every screen at three widths: no horizontal scroll, no undersized touch targets", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  const scrollFindings: string[] = [];
  const touchFindings: string[] = [];
  for (const width of LOOKS_RIGHT.widths) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      if (await hasHorizontalScroll(page)) scrollFindings.push(`${route} @ ${width}px has horizontal scroll`);
      for (const finding of await undersizedTouchTargets(page, LOOKS_RIGHT.minTouchTargetPx)) {
        touchFindings.push(`${route} @ ${width}px: ${finding}`);
      }
    }
  }
  expect(scrollFindings, `FR-38 [provisional] rule 1: ${JSON.stringify(scrollFindings)}`).toEqual([]);
  expect(touchFindings, `FR-38 [provisional] rule 3 (min ${LOOKS_RIGHT.minTouchTargetPx}px): ${JSON.stringify(touchFindings)}`).toEqual(
    [],
  );
});

// NOTE (report this, do not silently drop): FR-38's full method is 3 widths
// x 4 states x 5 routes, judged against rules 1-4 (scroll, clipping/overlap,
// touch-target size, layout collapse). Rules 1 and 3 are mechanically
// checkable and implemented above. Rules 2 and 4 ("nothing clipped/
// overlapping", "no layout collapse") are visual judgment calls a script
// cannot make reliably without a visual-diffing baseline (see the
// `visual-testing` skill, not loaded for this pass) -- asserting them here
// would either be a meaningless pixel-diff or a rubber-stamp. Also not yet
// covered: the 4-states axis (empty/loading/error/full) -- both checks
// above run only against whatever state each route lands in by default.

test("FR-39 [PROVISIONAL BAR] (browser half) on-screen strings: labels match their own error copy", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Create account" }).click(); // trigger validation without filling anything
  const usernameLabel = await page.getByLabel("Username", { exact: true }).evaluate((el) => {
    const label = document.querySelector(`label[for="${el.id}"]`);
    return label?.textContent ?? "";
  });
  const errors = await page.locator(".field-error, [role='alert']").allInnerTexts();
  const usernameErrors = errors.filter((err) => /username|user name/i.test(err));
  expect(
    usernameErrors.length,
    `FR-39 [provisional]: expected a username validation error on screen, found none among: ${JSON.stringify(errors)}`,
  ).toBeGreaterThan(0);
  // FR-39 known failure: "User name must between 3 and 20 characters" (missing
  // "be") and says "User name" where the label says "Username".
  for (const err of usernameErrors) {
    expect(err, `FR-39 [provisional]: error text "${err}" does not use the field's own label "${usernameLabel}"`).toContain(
      usernameLabel.trim() || "Username",
    );
  }
});

test("FR-40 built against the design (structural comparison, not pixel)", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);
  // Structural checks against docs/designs/Expenses Redesign.dc.html's
  // documented sections for /home and /dashboard.
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
  await expect(page.getByLabel("Message")).toBeVisible();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("Total spent")).toBeVisible();
  await expect(page.getByRole("region", { name: "By category" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent expenses" })).toBeVisible();
  // Divergences from the design file are a manual review item (structural,
  // not automatable without a design-diffing tool) -- recorded in the run
  // report as "not automated further this pass", per the case's own method.
});
