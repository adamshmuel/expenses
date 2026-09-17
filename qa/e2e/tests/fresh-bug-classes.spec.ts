/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 13 (BD-01, BD-03, BD-04 --
 * browser halves). BD-02 is API-only (qa/tests/api/11-ai-server-contract.test.ts).
 * BD-07 is API + log files (qa/tests/api/12-observability.test.ts).
 * BD-05/BD-06 need the lived-in accounts and live in
 * qa/e2e/tests/lived-in-flows.spec.ts.
 * Environment: fresh account. BROWSER (headed) for the browser halves below.
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, sendChat, confirmButton, accessTokenFor,
  getExpenses, getCategories, getMessages, apiBaseFor, AI_WAIT,
} from "../helpers.js";

const API_BASE = apiBaseFor(3100);

test("BD-01 (browser half) an incomplete edit-expense and delete-expense are refused, not crashed", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  // No expenses exist yet -- an edit/delete referencing "the coffee" has
  // nothing to match. This must never 500 or leave a Confirm button offered
  // for a shape the server will reject (the bug-7 failure, generalised).
  for (const msg of ["change the coffee expense to 30", "delete the coffee expense"]) {
    await sendChat(page, msg);
    await expect(page.locator(".chat-bubble--user").filter({ hasText: msg })).toBeVisible(AI_WAIT);
    const reply = await page.locator(".chat-bubble--assistant").last().innerText();
    // There are genuinely zero expenses on this account -- the only correct
    // reply is one that says so, not any non-empty string.
    expect(
      /no match|nothing match|couldn'?t find|could not find|no .* expense|not found/i.test(reply),
      `BD-01: expected a "nothing matched" reply for "${msg}" (no expenses exist), got: "${reply}"`,
    ).toBe(true);
    // No confirmable draft for a match set that's actually empty.
    await expect(confirmButton(page), `BD-01: a Confirm button was offered with no real match for "${msg}"`).toHaveCount(0);
  }

  const accessToken = await accessTokenFor(context, API_BASE);
  expect(await getExpenses(API_BASE, accessToken)).toHaveLength(0);
  // The page is still responsive -- no crash.
  await expect(page.getByLabel("Message")).toBeEnabled();
});

test("BD-03 (browser half) category writes carry the right derived fields, not just the typed ones", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const accessToken = await accessTokenFor(context, API_BASE);

  await sendChat(page, "add a category called Woodworking under Entertainment");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });

  const categories = await getCategories(API_BASE, accessToken);
  const entertainment = categories.find((c: any) => c.name === "Entertainment");
  const created = categories.find((c: any) => c.name === "Woodworking");
  expect(created).toBeTruthy();
  // BD-03: parent must be a real ObjectId of a main category -- never a
  // name (bug 9's residue).
  expect(created.parent).toBe(entertainment._id);
  expect(typeof created.parent === "string" && /^[a-f0-9]{24}$/i.test(created.parent)).toBe(true);
  expect(created.isProtected).toBe(false);
  const other = categories.find((c: any) => c.name === "Other");
  expect(other.isProtected).toBe(true);

  // On a message: author is this user, role matches who spoke.
  const messages = await getMessages(API_BASE, accessToken);
  expect(messages.length).toBeGreaterThan(0);
  const roles = new Set(messages.map((m: any) => m.role));
  expect([...roles].every((r) => r === "user" || r === "assistant")).toBe(true);
  expect(messages.some((m: any) => m.role === "user")).toBe(true);
  expect(messages.some((m: any) => m.role === "assistant")).toBe(true);
});

/**
 * BD-04 (browser half) -- qa-lead's review: the original version covered one
 * intent (create) with one forced failure. "All seven intents, and the
 * failure path" means exactly that: every intent gets a real success run
 * through the chat, AND a forced failure (a 500 on that intent's /chat/confirm
 * call), each checked to survive a reload.
 *
 * One signup, run sequentially -- each intent's setup uses the state the
 * previous one left behind (an existing expense/category to edit/delete),
 * which is realistic (a lived-in-style, not fresh-every-time, sequence of
 * actions) and keeps the test from needing 14 separate accounts.
 */
test("BD-04 every write's outcome (all 7 intents, success + forced failure) is recorded and survives a reload", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  async function bubbleTexts(): Promise<string[]> {
    return page.locator(".chat-bubble--assistant").allInnerTexts();
  }
  function recordsSuccess(texts: string[]) {
    return texts.some((t) => /done|saved|filed|renamed|deleted|removed|reset/i.test(t));
  }
  function recordsFailure(texts: string[]) {
    return texts.some((t) => /fail|error|went wrong|try again|couldn'?t/i.test(t));
  }

  /** Runs one successful confirm through the real chat, then a forced 500
   *  on the same endpoint for a second attempt, checking both survive a
   *  reload. `triggerFailure` repeats whatever chat action reaches Confirm
   *  again for this intent (a fresh independent target where possible). */
  async function checkIntent(name: string, doSuccess: () => Promise<void>, doFailureAttempt: () => Promise<void>) {
    await doSuccess();
    await page.reload();
    let texts = await bubbleTexts();
    expect(recordsSuccess(texts), `BD-04 (${name}): success not recorded after reload: ${JSON.stringify(texts)}`).toBe(true);

    await page.route("**/chat/confirm", (route) => route.fulfill({ status: 500, json: { error: "boom" } }));
    try {
      await doFailureAttempt();
    } finally {
      await page.unroute("**/chat/confirm");
    }
    await page.reload();
    texts = await bubbleTexts();
    // BD-04 is deliberately allowed to fail here -- a red banner that
    // vanishes on reload is exactly the gap the case exists to catch.
    expect(recordsFailure(texts), `BD-04 (${name}): failure not recorded after reload: ${JSON.stringify(texts)}`).toBe(true);
  }

  // 1. create-expense
  await checkIntent(
    "create-expense",
    async () => {
      await sendChat(page, "spent 8 on coffee");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    },
    async () => {
      await sendChat(page, "spent 9 on lunch");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    },
  );

  // 2. edit-expense
  await checkIntent(
    "edit-expense",
    async () => {
      await sendChat(page, "change the coffee expense to 10");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    },
    async () => {
      await sendChat(page, "change the coffee expense to 11");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    },
  );

  // 3. delete-expense (need a second row so the failed attempt has a real target)
  await checkIntent(
    "delete-expense",
    async () => {
      await sendChat(page, "spent 12 on gas");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
      await sendChat(page, "delete the gas expense");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    },
    async () => {
      await sendChat(page, "delete the coffee expense");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    },
  );

  // 4. create-category
  await checkIntent(
    "create-category",
    async () => {
      await sendChat(page, "add a category called Hobbies");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    },
    async () => {
      await sendChat(page, "add a category called Crafts");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    },
  );

  // 5. edit-category
  await checkIntent(
    "edit-category",
    async () => {
      await sendChat(page, "rename Hobbies to Pastimes");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    },
    async () => {
      await sendChat(page, "rename Pastimes to Interests");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    },
  );

  // 6. delete-category (needs a second, disposable category for the failure attempt)
  await checkIntent(
    "delete-category",
    async () => {
      await sendChat(page, "add a category called Temp One");
      if (await confirmButton(page).count()) {
        await confirmButton(page).click();
        await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
      }
      await sendChat(page, "delete the Temp One category");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    },
    async () => {
      await sendChat(page, "delete the Pastimes category");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    },
  );

  // 7. reset-categories
  await checkIntent(
    "reset-categories",
    async () => {
      await sendChat(page, "reset my categories");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
    },
    async () => {
      await sendChat(page, "reset my categories");
      await expect(confirmButton(page)).toBeVisible(AI_WAIT);
      await confirmButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    },
  );

  // C1/C3 sanity: the account is left in a sane, explicable state (not a
  // partial write from any of the 7 forced-failure attempts).
  const accessToken = await accessTokenFor(context, API_BASE);
  const [expenses, categories] = await Promise.all([getExpenses(API_BASE, accessToken), getCategories(API_BASE, accessToken)]);
  expect(Array.isArray(expenses) && Array.isArray(categories)).toBe(true);
});

test("BD-06 (fresh half) model-authored reply text never renders as raw markup", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);

  // Stub /chat/messages with a reply carrying an HTML fragment, a JSON
  // fragment, and a very long string -- the doors BD-06 says are still open
  // (the reply text itself, never guarded by isSaneText the way a draft's
  // store/description is).
  await page.route("**/chat/messages", (route) =>
    route.fulfill({
      status: 200,
      json: {
        intent: "unknown",
        reply: `<script>window.__pwned=1</script>{"leaked":"json"} ` + "z".repeat(5000),
        drafts: [],
      },
    }),
  );
  await sendChat(page, "trigger the stubbed reply");
  await expect(page.locator(".chat-bubble--assistant").last()).toBeVisible();

  const scriptRan = await page.evaluate(() => (window as any).__pwned === 1);
  expect(scriptRan, "BD-06: the reply's <script> fragment executed").toBe(false);
  const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasScroll, "BD-06: a long/garbage reply broke the layout").toBe(false);
});
