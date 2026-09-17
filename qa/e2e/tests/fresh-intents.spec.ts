/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 5 (FR-24 .. FR-27).
 * Environment: fresh account. BROWSER (headed).
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, sendChat, confirmButton, accessTokenFor,
  getExpenses, getCategories, apiBaseFor, AI_WAIT,
} from "../helpers.js";

const API_BASE = apiBaseFor(3100);

test("FR-24 edit an expense changes only what was named (C1)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 20 on coffee at Aroma");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const before = (await getExpenses(API_BASE, accessToken))[0];

  await sendChat(page, "change that coffee to 24");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(1);
  const after = expenses[0];
  expect(after.amount).toBe(24);
  expect(after.store).toBe(before.store);
  expect(after.description).toBe(before.description);
  expect(after.date).toBe(before.date);
  expect(after.category).toBe(before.category);
  expect(after.updatedAt).not.toBe(before.updatedAt);
});

test("FR-25 delete removes exactly one", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 15 on lunch and 25 on gas");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getExpenses(API_BASE, accessToken);
  expect(before).toHaveLength(2);

  await sendChat(page, "delete the lunch expense");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const after = await getExpenses(API_BASE, accessToken);
  expect(after).toHaveLength(1);
  expect(after[0].amount).toBe(25);
});

test("FR-26 category creation obeys the rules", async ({ page, context }) => {
  test.setTimeout(150_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const accessToken = await accessTokenFor(context, API_BASE);
  const before = await getCategories(API_BASE, accessToken);

  // 1. A subcategory under a main category succeeds.
  await sendChat(page, "add a category called Museums under Entertainment");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
  const afterFirst = await getCategories(API_BASE, accessToken);
  const created = afterFirst.find((c: any) => c.name === "Museums");
  expect(created).toBeTruthy();
  expect(created.isProtected).toBe(false);
  const entertainment = before.find((c: any) => c.name === "Entertainment");
  expect(created.parent).toBe(entertainment._id);

  // 2. A third level (subcategory under a subcategory) is refused.
  await sendChat(page, "add a category called Modern Art under Museums");
  const reply2 = await page.locator(".chat-bubble--assistant").last().innerText();
  expect(/cannot|can't|two levels|not allowed|refus/i.test(reply2) || (await confirmButton(page).count()) === 0).toBeTruthy();
  if (await confirmButton(page).count()) await confirmButton(page).click();
  const afterThirdLevel = await getCategories(API_BASE, accessToken);
  expect(afterThirdLevel.some((c: any) => c.name === "Modern Art")).toBe(false);

  // 3. A duplicate name under the same parent is refused.
  await sendChat(page, "add a category called Museums under Entertainment");
  if (await confirmButton(page).count()) await confirmButton(page).click();
  const afterDup = await getCategories(API_BASE, accessToken);
  expect(afterDup.filter((c: any) => c.name === "Museums")).toHaveLength(1);

  // 4. Renaming "Other" is refused.
  await sendChat(page, "rename Other to Misc");
  if (await confirmButton(page).count()) await confirmButton(page).click();
  const afterRename = await getCategories(API_BASE, accessToken);
  expect(afterRename.some((c: any) => c.name === "Other")).toBe(true);
  expect(afterRename.some((c: any) => c.name === "Misc")).toBe(false);

  // 5. Deleting "Other" is refused.
  await sendChat(page, "delete the Other category");
  if (await confirmButton(page).count()) await confirmButton(page).click();
  const afterDelete = await getCategories(API_BASE, accessToken);
  expect(afterDelete.some((c: any) => c.name === "Other")).toBe(true);
});

test("FR-27 reset categories is confirmed and loses nothing", async ({ page, context }) => {
  test.setTimeout(120_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const accessToken = await accessTokenFor(context, API_BASE);

  await sendChat(page, "add a category called Museums under Entertainment");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
  const categories = await getCategories(API_BASE, accessToken);
  const museums = categories.find((c: any) => c.name === "Museums");

  await sendChat(page, "spent 10 on museums under Museums");
  if (await confirmButton(page).count()) {
    await confirmButton(page).click();
    await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
  }
  const before = await getExpenses(API_BASE, accessToken);
  const countBefore = before.length;

  await sendChat(page, "reset my categories");
  const reply = await page.locator(".chat-bubble--assistant").last().innerText();
  expect(/sure|confirm|reset/i.test(reply)).toBe(true);
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const afterCategories = await getCategories(API_BASE, accessToken);
  expect(afterCategories).toHaveLength(17);
  expect(afterCategories.some((c: any) => c.name === "Museums")).toBe(false);

  const afterExpenses = await getExpenses(API_BASE, accessToken);
  expect(afterExpenses).toHaveLength(countBefore);
  const other = afterCategories.find((c: any) => c.name === "Other");
  const orphaned = before.find((e: any) => e.category === museums?._id);
  if (orphaned) {
    const moved = afterExpenses.find((e: any) => e._id === orphaned._id);
    expect(moved.category).toBe(other._id);
  }
});
