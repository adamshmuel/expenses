/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 7 (FR-28 .. FR-31).
 * Environment: fresh account. BROWSER (headed); FR-31's API half (all 9
 * inputs) is in qa/tests/api/13-fresh-split-halves.test.ts -- this file
 * covers its "at least two through the real chat screen" requirement.
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, sendChat, userBubble, confirmButton, accessTokenFor,
  getExpenses, getCategories, apiBaseFor, logAIRaw, AI_WAIT,
} from "../helpers.js";

const API_BASE = apiBaseFor(3100);

test("FR-28 many expenses in one sentence: 5, then 10", async ({ page, context }) => {
  test.setTimeout(150_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const accessToken = await accessTokenFor(context, API_BASE);

  const five = "spent 10 on coffee, 20 on lunch, 30 on gas, 40 on parking, and 50 on a book";
  await sendChat(page, five);
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  const draftItemsFive = page.locator(".chat-drafts li");
  expect(await draftItemsFive.count()).toBeGreaterThanOrEqual(5);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  let expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(5);
  expect(expenses.map((e: any) => e.amount).sort((a: number, b: number) => a - b)).toEqual([10, 20, 30, 40, 50]);

  const ten =
    "spent 11 on coffee, 12 on lunch, 13 on gas, 14 on parking, 15 on a book, 16 on a movie, 17 on a shirt, 18 on rent, 19 on internet, and 20 on the gym";
  await sendChat(page, ten);
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  const draftItemsTen = page.locator(".chat-drafts li");
  expect(await draftItemsTen.count()).toBeGreaterThanOrEqual(10);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(15);
  const categories = await getCategories(API_BASE, accessToken);
  const categoryIds = new Set(categories.map((c: any) => c._id));
  for (const e of expenses) expect(categoryIds.has(e.category)).toBe(true);
});

test("FR-29 a category that does not exist yet is never silently saved against it", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const accessToken = await accessTokenFor(context, API_BASE);
  const categoriesBefore = await getCategories(API_BASE, accessToken);

  await sendChat(page, "spent 50 on a new bike helmet");
  await expect(userBubble(page, "spent 50 on a new bike helmet")).toBeVisible(AI_WAIT);

  if (await confirmButton(page).count()) {
    const cardText = await page.locator(".chat-confirm").innerText();
    const realNames = new Set(categoriesBefore.map((c: any) => c.name));
    const namesOnlyRealOrIsNewCategoryDraft =
      [...realNames].some((n) => cardText.includes(n as string)) || /under|new category/i.test(cardText);
    expect(namesOnlyRealOrIsNewCategoryDraft).toBe(true);
    await confirmButton(page).click();
    await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
  }

  const categoriesAfter = await getCategories(API_BASE, accessToken);
  const delta = categoriesAfter.length - categoriesBefore.length;
  expect([0, 1]).toContain(delta);
});

test("FR-30 a missing category supplied a turn later", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "paid 50");
  await expect(userBubble(page, "paid 50")).toBeVisible(AI_WAIT);
  await expect(confirmButton(page)).toHaveCount(0);

  await sendChat(page, "parking");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  const categories = await getCategories(API_BASE, accessToken);
  expect(expenses).toHaveLength(1);
  expect(expenses[0].amount).toBe(50);
  const parkingCat = categories.find((c: any) => c._id === expenses[0].category);
  expect(parkingCat?.name.toLowerCase()).toContain("parking");
});

test("FR-31 (browser half) unrelated and nonsense input -- at least two sent through the real chat", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const accessToken = await accessTokenFor(context, API_BASE);
  const categoriesBefore = await getCategories(API_BASE, accessToken);

  for (const msg of ["hello", "50"]) {
    await sendChat(page, msg);
    await expect(userBubble(page, msg)).toBeVisible(AI_WAIT);
    const replyForLog = await page.locator(".chat-bubble--assistant").last().innerText();
    logAIRaw("FR-31", msg, { reply: replyForLog, hasConfirm: (await confirmButton(page).count()) > 0 });
    // Never save anything from an unresolvable/context-free message.
    if (await confirmButton(page).count()) {
      // A draft is only acceptable if it does not silently invent an expense
      // from a bare, context-free number -- fail loudly otherwise.
      expect(msg, "FR-31: a bare number with no context produced a confirmable draft").not.toBe("50");
    }
  }

  const expenses = await getExpenses(API_BASE, accessToken);
  const categoriesAfter = await getCategories(API_BASE, accessToken);
  expect(expenses).toHaveLength(0);
  expect(categoriesAfter).toHaveLength(categoriesBefore.length);
  // The app must not have crashed -- the page is still responsive.
  await expect(page.getByLabel("Message")).toBeEnabled();
});

test("XS-05 (browser half) bad amounts are refused in words the user can read, nothing saved", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  const REFUSAL_PATTERN = /invalid|greater than|more than|positive|zero|can'?t|cannot|not a valid|must be/i;
  for (const msg of ["spent -50 on coffee", "spent 0 on coffee"]) {
    await sendChat(page, msg);
    await expect(userBubble(page, msg)).toBeVisible(AI_WAIT);
    // A draft card offering this for confirmation is itself the failure,
    // even if the server would later have refused it.
    const hasConfirm = (await page.getByRole("button", { name: "Confirm" }).count()) > 0;
    const reply = await page.locator(".chat-bubble--assistant").last().innerText();
    logAIRaw("XS-05", msg, { reply, hasConfirm });
    // Whichever branch: the case demands a refusal IN WORDS THE USER CAN
    // READ, not merely "some non-empty reply" -- that was true even of the
    // observed bug (a confident false acceptance is also non-empty).
    expect(
      REFUSAL_PATTERN.test(reply),
      `XS-05: "${msg}" produced no readable refusal (hasConfirm=${hasConfirm}): "${reply}"`,
    ).toBe(true);
    if (hasConfirm) await page.getByRole("button", { name: "Cancel" }).click();
  }

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(0);
});
