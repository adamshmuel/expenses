import { test, expect, type BrowserContext } from "@playwright/test";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

// Spec: qa/specs/e2e-chat-stress-flows.md (FS-01 .. FS-07).
// Governed by docs/specs/01-ai-chat.md §6-7. Companion to
// qa/e2e/tests/chat-dashboard-journey.spec.ts's FJ-01/DJ-01 (the single
// happy-path walk) -- these are the multi-turn, corrected, abandoned, and
// adversarial shapes named in qa/flow-analysis-2026-09-16.md, drawn from the
// eleven bugs found by hand on 2026-09-16.
//
// Every test here makes at least one real Gemini call (kept to the minimum
// turns each scenario needs). Loose on the model's own wording, strict on
// stored data and structural behaviour.
const E2E_PORT = 3100;
const API_BASE = `http://127.0.0.1:${E2E_PORT}`;
const AI_WAIT = { timeout: 45_000 };

/** Mint a fresh access token from this browser session's own refresh cookie,
 *  the same pattern FJ-01 uses -- proves the save really happened
 *  server-side, not just in optimistic UI state. */
async function accessTokenFor(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const refreshCookie = cookies.find((c) => c.name === "refreshToken");
  expect(refreshCookie, "browser session must have a refreshToken cookie").toBeTruthy();
  const res = await fetch(`${API_BASE}/users/refresh`, {
    method: "POST",
    headers: { Cookie: `refreshToken=${refreshCookie!.value}` },
  });
  const body = await safeJson(res);
  return body.accessToken as string;
}

async function getExpenses(accessToken: string) {
  const res = await fetch(`${API_BASE}/expenses`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return safeJson(res);
}

async function getCategories(accessToken: string) {
  const res = await fetch(`${API_BASE}/categories`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return safeJson(res);
}

async function getMessages(accessToken: string) {
  const res = await fetch(`${API_BASE}/chat/messages`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return safeJson(res);
}

async function signUpThroughUI(page: any, user: ReturnType<typeof makeUser>) {
  await page.goto("/signup");
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

async function sendChat(page: any, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

/** The user's own chat bubble with this exact text -- scoped to
 *  `.chat-bubble--user` specifically, not a bare role/text filter. The
 *  assistant sometimes echoes the user's own words back verbatim in its
 *  reply (e.g. "I see you spent 45 on a new bike..."), which makes an
 *  unscoped `getByRole("listitem").filter({hasText})` match both bubbles
 *  and throw a strict-mode violation -- a test-locator bug, not a product
 *  one (found while writing FS-04). */
function userBubble(page: any, text: string) {
  return page.locator(".chat-bubble--user").filter({ hasText: text });
}

test("FS-01 missing amount, answered in a follow-up turn (conversation memory)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent money at the supermarket");
  // No amount stated -- the model must not invent one, so no Confirm yet.
  // Both bubbles land together once the round trip resolves (chatSlice
  // pushes user+assistant together on fulfilled), so waiting for the user's
  // own bubble is equivalent to waiting for the AI reply, without a fixed sleep.
  await expect(userBubble(page, "spent money at the supermarket")).toBeVisible(AI_WAIT);
  const confirmButton = page.getByRole("button", { name: "Confirm" });
  await expect(confirmButton).toHaveCount(0);

  await sendChat(page, "50");
  await expect(confirmButton).toBeVisible(AI_WAIT);
  await confirmButton.click();
  await expect(confirmButton).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context);
  const [expenses, categories] = await Promise.all([getExpenses(accessToken), getCategories(accessToken)]);
  expect(expenses).toHaveLength(1);
  const saved = expenses[0];
  expect(saved.amount).toBe(50);
  expect(categories.some((c: any) => c._id === saved.category)).toBe(true);
  expect(saved.date.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
});

test("FS-02 the user corrects a draft before confirming", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 30 on transport");
  const confirmButton = page.getByRole("button", { name: "Confirm" });
  await expect(confirmButton).toBeVisible(AI_WAIT);
  const firstReply = await page.locator(".chat-bubble--assistant").last().innerText();

  await sendChat(page, "actually make that 50");
  await expect(confirmButton).toBeVisible(AI_WAIT);
  const secondReply = await page.locator(".chat-bubble--assistant").last().innerText();
  // The exact regression named in the bug-fix file: an identical reply to a
  // correction is the single worst failure.
  expect(secondReply).not.toBe(firstReply);

  await confirmButton.click();
  await expect(confirmButton).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context);
  const expenses = await getExpenses(accessToken);
  // The correction must replace the draft, not add a second expense.
  expect(expenses).toHaveLength(1);
  expect(expenses[0].amount).toBe(50);
});

test("FS-03 several expenses in one message", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "I spent 20 on coffee and 15 on the bus");
  const confirmButton = page.getByRole("button", { name: "Confirm" });
  await expect(confirmButton).toBeVisible(AI_WAIT);
  const draftItems = page.locator(".chat-drafts li");
  await expect(draftItems).not.toHaveCount(0);
  const draftCount = await draftItems.count();
  expect(draftCount).toBeGreaterThanOrEqual(2);

  await confirmButton.click();
  await expect(confirmButton).toHaveCount(0, { timeout: 10_000 });

  const accessToken = await accessTokenFor(context);
  const [expenses, categories] = await Promise.all([getExpenses(accessToken), getCategories(accessToken)]);
  expect(expenses).toHaveLength(2);
  expect(expenses.map((e: any) => e.amount).sort((a: number, b: number) => a - b)).toEqual([15, 20]);
  const categoryIds = new Set(categories.map((c: any) => c._id));
  for (const expense of expenses) {
    expect(categoryIds.has(expense.category)).toBe(true);
    expect(expense.date.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  }
});

test("FS-04 a category that doesn't exist yet is never silently saved", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 45 on a new bike");
  // Give the AI call time to land, whichever shape the reply takes.
  await expect(userBubble(page, "spent 45 on a new bike")).toBeVisible(AI_WAIT);

  const accessToken = await accessTokenFor(context);
  const categories = await getCategories(accessToken);
  const realNames = new Set(categories.map((c: any) => c.name));

  const confirmButton = page.getByRole("button", { name: "Confirm" });
  const hasConfirm = (await confirmButton.count()) > 0;
  if (hasConfirm) {
    const draftText = await page.locator(".chat-confirm").innerText();
    // If a create-expense draft is shown, its category must be one of this
    // user's real categories -- never the nonexistent "Bike" verbatim as an
    // expense category. (A create-category draft proposing "Bike" itself is
    // fine -- that's intent create-category, not create-expense.)
    const mentionsOnlyRealCategoryOrIsCategoryDraft =
      [...realNames].some((name) => draftText.includes(name as string)) || draftText.includes("under");
    expect(mentionsOnlyRealCategoryOrIsCategoryDraft).toBe(true);
  }

  // Whichever branch happened, this test never clicks Confirm -- nothing
  // must be silently saved under a category that was never real.
  const expenses = await getExpenses(accessToken);
  expect(expenses).toHaveLength(0);
});

test("FS-05 reloading mid-conversation loses the pending draft, keeps the history", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 20 on coffee");
  const confirmButton = page.getByRole("button", { name: "Confirm" });
  await expect(confirmButton).toBeVisible(AI_WAIT);

  await page.reload();
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await expect(userBubble(page, "spent 20 on coffee")).toBeVisible();

  const accessToken = await accessTokenFor(context);
  const [messages, expenses] = await Promise.all([getMessages(accessToken), getExpenses(accessToken)]);
  expect(messages.some((m: any) => m.text === "spent 20 on coffee")).toBe(true);
  expect(messages.some((m: any) => m.role === "assistant")).toBe(true);
  expect(expenses).toHaveLength(0);
});

test("FS-06 logging out and back in mid-conversation preserves history, not the draft", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 15 on lunch");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible(AI_WAIT);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/);

  await expect(userBubble(page, "spent 15 on lunch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);

  const accessToken = await accessTokenFor(context);
  const expenses = await getExpenses(accessToken);
  expect(expenses).toHaveLength(0);
});

test("FS-07 typing 'yes' instead of clicking Confirm (bug 6, documents current open behaviour)", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 20 on coffee");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible(AI_WAIT);

  await sendChat(page, "yes");
  // Give the second AI call time to land.
  await expect(userBubble(page, "yes")).toBeVisible(AI_WAIT);

  // Current, intentionally open behaviour (bug 6): typing "yes" must not
  // silently confirm the pending draft. Asserted as current behaviour to
  // catch a regression in either direction -- see the spec file for what to
  // do when Adam decides this should change.
  const accessToken = await accessTokenFor(context);
  const expenses = await getExpenses(accessToken);
  expect(expenses.some((e: any) => e.amount === 20)).toBe(false);
});
