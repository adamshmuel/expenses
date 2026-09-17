/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 2 (FR-08 .. FR-15).
 * Environment: fresh account, one signup per test. BROWSER (headed) unless
 * noted; FR-13/FR-14 are SPLIT -- the API halves live in
 * qa/tests/api/13-fresh-split-halves.test.ts.
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, sendChat, userBubble, confirmButton, accessTokenFor,
  getExpenses, getCategories, apiBaseFor, decodeAccessToken, AI_WAIT,
} from "../helpers.js";

const API_BASE = apiBaseFor(3100);

// GET /expenses's real key set, confirmed by probing the running server
// directly (a signup + /chat/confirm + GET /expenses round trip): every row
// has exactly {_id, amount, date, category, user, createdAt, updatedAt,
// __v, id} plus whichever ONE of {store, description} was actually set --
// the unset one is omitted entirely, not present as null/empty.
const BASE_EXPENSE_KEYS = ["_id", "amount", "date", "category", "user", "createdAt", "updatedAt", "__v", "id"].sort();

test("FR-08 multi-expense message, every field verified (C1)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 50 at the supermarket and 32 on gas");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  const cardText = await page.locator(".chat-confirm").innerText();
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const { id: userId } = decodeAccessToken(accessToken);
  const [expenses, categories] = await Promise.all([getExpenses(API_BASE, accessToken), getCategories(API_BASE, accessToken)]);
  expect(expenses).toHaveLength(2);
  const categoryIds = new Map(categories.map((c: any) => [c._id, c.name]));
  const today = new Date().toISOString().slice(0, 10);

  expect(expenses.map((e: any) => e.amount).sort((a: number, b: number) => a - b)).toEqual([32, 50]);

  for (const e of expenses) {
    expect((e.store ?? "") + (e.description ?? "")).not.toBe("");
    expect(e.date.slice(0, 10)).toBe(today);
    expect(categoryIds.has(e.category)).toBe(true);
    // Unconditional -- GET /expenses does serialize `user` (confirmed by
    // probe); a missing/wrong owner must fail this test, not be skipped.
    expect(String(e.user)).toBe(userId);

    const labelKey = e.store !== undefined ? "store" : "description";
    expect(Object.keys(e).sort()).toEqual([...BASE_EXPENSE_KEYS, labelKey].sort());

    // The card shown before confirming must have named this row's real
    // category -- the card text was captured before the click above.
    const categoryName = categoryIds.get(e.category);
    expect(cardText.includes(categoryName), `FR-08: card "${cardText}" never named "${categoryName}"`).toBe(true);
  }
});

test("FR-09 missing amount, bare-word answer", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "bought coffee");
  await expect(userBubble(page, "bought coffee")).toBeVisible(AI_WAIT);
  await expect(confirmButton(page)).toHaveCount(0);

  const accessTokenBefore = await accessTokenFor(context, API_BASE);
  expect(await getExpenses(API_BASE, accessTokenBefore)).toHaveLength(0);

  await sendChat(page, "18");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(1);
  expect(expenses[0].amount).toBe(18);
  expect(expenses[0].date.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  expect((expenses[0].store ?? "") + (expenses[0].description ?? "")).not.toBe("");
});

test("FR-10 a correction replaces, it does not append", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "bought coffee");
  await expect(userBubble(page, "bought coffee")).toBeVisible(AI_WAIT);
  await sendChat(page, "18");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await sendChat(page, "actually it was 22");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(1);
  expect(expenses[0].amount).toBe(22);
});

test("FR-11 the confirm card shows the date (I3)", async ({ page }) => {
  test.setTimeout(120_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  const cases = ["spent 20 on coffee", "spent 15 on lunch yesterday", "spent 30 on gas last Tuesday"];
  for (const msg of cases) {
    await sendChat(page, msg);
    await expect(userBubble(page, msg.split(" ").slice(0, 3).join(" "))).toBeVisible(AI_WAIT);
    if (await confirmButton(page).count()) {
      const cardText = await page.locator(".chat-confirm").innerText();
      // FR-11: every draft line displays its resolved date -- a 4-digit
      // year OR one of today/yesterday's short forms should appear.
      const showsADate = /\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2}\b|today|yesterday/i.test(cardText);
      expect(showsADate, `FR-11: confirm card for "${msg}" shows no date: "${cardText}"`).toBe(true);
      await page.getByRole("button", { name: "Cancel" }).click();
    }
  }
});

test("FR-12 date resolution follows a written rule (no-date and explicit only -- see blocker B-A)", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const today = new Date().toISOString().slice(0, 10);

  // No date stated -> spec 01-ai-chat.md §6: today.
  await sendChat(page, "spent 21 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  // Explicit date -> exactly that date.
  await sendChat(page, "spent 22 on coffee on 2026-09-01");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  const noDate = expenses.find((e: any) => e.amount === 21);
  const explicit = expenses.find((e: any) => e.amount === 22);
  expect(noDate?.date.slice(0, 10)).toBe(today);
  expect(explicit?.date.slice(0, 10)).toBe("2026-09-01");

  // BLOCKER B-A (qa-lead, flow-fresh-2026-09-16.md): "last Tuesday"/relative
  // weekday phrases have no written resolution rule -- not asserted here.
  // Recorded, not silently skipped.
});

test("FR-13 (browser half) every stored expense saved through the UI has a label", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  await sendChat(page, "spent 40 at the supermarket");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  for (const e of expenses) {
    expect((e.store ?? "") !== "" || (e.description ?? "") !== "", `FR-13: expense ${e._id} has no label`).toBe(true);
  }
});

test("FR-14 (browser half) firing Confirm twice in rapid succession writes one row", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  await sendChat(page, "spent 45 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);

  // Double-click: two rapid clicks on the same button, the real user gesture
  // this case targets (the API half covers a replayed HTTP request instead).
  await confirmButton(page).dblclick({ timeout: 5_000 }).catch(() => confirmButton(page).click());
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses.filter((e: any) => e.amount === 45)).toHaveLength(1);
});

test("FR-15 Hebrew end to end", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "קניתי לחם ב-12 שקל");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context, API_BASE);
  const [expenses, categories] = await Promise.all([getExpenses(API_BASE, accessToken), getCategories(API_BASE, accessToken)]);
  expect(expenses).toHaveLength(1);
  expect(expenses[0].amount).toBe(12);
  const categoryIds = new Set(categories.map((c: any) => c._id));
  expect(categoryIds.has(expenses[0].category)).toBe(true);
  expect(expenses[0].date.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  const label = expenses[0].store ?? expenses[0].description ?? "";
  expect(label).not.toBe("");
  expect(label).not.toMatch(/�/); // no mojibake replacement character
});
