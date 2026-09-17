/**
 * Spec: qa/specs/flow-fresh-2026-09-16.md Group 1 (FR-01 .. FR-07).
 * Environment: fresh account, one signup per test. Layer: BROWSER (headed)
 * for every case in this file -- no API-level substitute, per the spec's own
 * "Layer discipline" section.
 *
 * These are the highest-severity cases in the fresh spec: several are
 * already known (from the exploratory session) to fail against the current
 * build. They are written to the spec's real expectation, not loosened to
 * pass -- see .claude/rules/tdd.md and the task brief ("a red test here is a
 * correct test").
 */
import { test, expect } from "@playwright/test";
import {
  makeUser, signUpThroughUI, sendChat, userBubble, assistantBubble, confirmButton, cancelButton,
  accessTokenFor, getExpenses, getCategories, apiBaseFor, looksLikeSaveClaim, logAIRaw, AI_WAIT,
} from "../helpers.js";

const API_BASE = apiBaseFor(3100);

test("FR-01 Enter sends the message", async ({ page }) => {
  const user = makeUser();
  await signUpThroughUI(page, user);

  const input = page.getByLabel("Message");
  await input.fill("spent 50 at the supermarket");
  const responsePromise = page
    .waitForResponse((r) => r.url().includes("/chat/messages") && r.request().method() === "POST", { timeout: 10_000 })
    .catch(() => null);
  await input.press("Enter");
  const response = await responsePromise;

  expect(response, "FR-01: POST /chat/messages must fire when Enter is pressed, not just Send").not.toBeNull();
  await expect(input).toHaveValue("");
  await expect(assistantBubble(page)).toBeVisible(AI_WAIT);
});

test("FR-02 a save claim is never made without a save", async ({ page, context }) => {
  test.setTimeout(120_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "bought coffee");
  await expect(userBubble(page, "bought coffee")).toBeVisible(AI_WAIT);
  await sendChat(page, "18");
  await expect(userBubble(page, "18")).toBeVisible(AI_WAIT);
  await sendChat(page, "actually it was 22, and it was at Aroma");
  await expect(userBubble(page, "actually it was 22")).toBeVisible(AI_WAIT);
  // Free-text "yes" -- deliberately not clicking Confirm.
  await sendChat(page, "yes");
  await expect(userBubble(page, "yes")).toBeVisible(AI_WAIT);

  const bubbleTexts = await assistantBubble(page).allInnerTexts();
  const claimsSave = bubbleTexts.some(looksLikeSaveClaim);

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  const matchingRow = expenses.find((e: any) => e.amount === 22 && (e.store === "Aroma" || e.description === "Aroma"));

  // C1/C2: either exactly one correct row exists, or no assistant message
  // claims a save happened. Never a claim with nothing behind it.
  if (claimsSave) {
    expect(
      matchingRow,
      "FR-02: an assistant message claimed a save, but no matching expense (amount 22, Aroma) exists",
    ).toBeTruthy();
    expect(expenses).toHaveLength(1);
  } else {
    expect(expenses.filter((e: any) => e.amount === 22)).toHaveLength(0);
  }
});

test("FR-03 typing 'yes' either works or says plainly that it cannot", async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 20 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await sendChat(page, "yes");
  await expect(userBubble(page, "yes")).toBeVisible(AI_WAIT);

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  const saved = expenses.find((e: any) => e.amount === 20);
  if (!saved) {
    // C3: nothing written -- the reply must say plainly that "yes" isn't a
    // control, not stay silent about it.
    const lastReply = await assistantBubble(page).last().innerText();
    expect(
      /confirm|button|click/i.test(lastReply),
      `FR-03: nothing was saved and the reply did not point at the Confirm control: "${lastReply}"`,
    ).toBe(true);
  } else {
    // The other acceptable outcome (C1): "yes" worked, so the saved row
    // must have every field right, same as any other confirm -- not just
    // "something with amount 20 exists".
    expect(saved.date.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect((saved.store ?? "") !== "" || (saved.description ?? "") !== "", "FR-03: saved row has no label").toBe(true);
    const categories = await getCategories(API_BASE, accessToken);
    expect(
      categories.some((c: any) => c._id === saved.category),
      "FR-03: saved row's category is not a real, owned category",
    ).toBe(true);
    expect(expenses).toHaveLength(1);
  }
});

/** Every distinct number in a piece of text, normalised (strips a trailing
 *  ".00" so "50" and "50.00" compare equal) -- used to compare what the
 *  reply says against what the card shows. */
function extractAmounts(text: string): Set<string> {
  const matches = [...text.matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) => m[0]);
  return new Set(matches.map((n) => String(Number(n))));
}

/** Which of this account's real category names are named in `text`, word-
 *  bounded so "Food" doesn't match inside an unrelated word. */
function categoriesMentionedIn(text: string, categoryNames: string[]): Set<string> {
  const found = new Set<string>();
  for (const name of categoryNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) found.add(name);
  }
  return found;
}

test("FR-04 prose and payload agree, across 8 canonical messages (SPLIT: browser half)", async ({ page, context }) => {
  test.setTimeout(180_000);
  const user = makeUser();
  await signUpThroughUI(page, user);
  const accessToken = await accessTokenFor(context, API_BASE);
  const categoryNames = (await getCategories(API_BASE, accessToken)).map((c: any) => c.name);

  const messages = [
    "spent 50 at the supermarket",
    "coffee, 18",
    "paid 30 for parking",
    "40 at the pharmacy",
    "bought a book for 60",
    "gas — 220",
    "spent 15 on lunch and 10 on the bus",
    "electricity, 340",
  ];

  for (const msg of messages) {
    await sendChat(page, msg);
    await expect(userBubble(page, msg)).toBeVisible(AI_WAIT);
    const reply = await assistantBubble(page).last().innerText();
    const cardVisible = (await page.locator(".chat-confirm").count()) > 0;
    const cardTextForLog = cardVisible ? await page.locator(".chat-confirm").innerText() : null;
    logAIRaw("FR-04", msg, { reply, cardVisible, cardText: cardTextForLog });

    // A reply phrased as asking to save something must actually offer a
    // card to save -- a question with nothing behind it is exactly the
    // dead-end class FR-41 also covers, and here it means the payload half
    // (drafts) silently disagrees with the prose half (reply).
    const asksToSave = /\?\s*$/.test(reply.trim()) && /save|add|record|log|confirm/i.test(reply);
    if (asksToSave) {
      expect(cardVisible, `FR-04: reply asks to save/confirm but no card rendered: "${reply}"`).toBe(true);
    }

    if (cardVisible) {
      const cardText = await page.locator(".chat-confirm").innerText();
      const replyAmounts = extractAmounts(reply);
      const cardAmounts = extractAmounts(cardText);
      expect(
        cardAmounts,
        `FR-04 ("${msg}"): amounts on the card (${[...cardAmounts]}) don't match the reply's (${[...replyAmounts]}). reply="${reply}" card="${cardText}"`,
      ).toEqual(replyAmounts);

      const replyCategories = categoriesMentionedIn(reply, categoryNames);
      const cardCategories = categoriesMentionedIn(cardText, categoryNames);
      expect(
        cardCategories,
        `FR-04 ("${msg}"): categories on the card (${[...cardCategories]}) don't match the reply's (${[...replyCategories]}). reply="${reply}" card="${cardText}"`,
      ).toEqual(replyCategories);
    }
    // Cancel/confirm to move to a clean state for the next message.
    if (await confirmButton(page).count()) await confirmButton(page).click();
    else if (await cancelButton(page).count()) await cancelButton(page).click();
    await page.waitForTimeout(200);
  }
});

/**
 * FR-05 (browser half). qa-lead's review: the original version hoped a
 * single ambiguous real-model message would land in a rejection branch, and
 * accepted any non-empty reply as proof -- it proved nothing. This forces
 * each of `buildPending`'s four documented rejection branches
 * (client/src/store/chatSlice.ts) directly via a stubbed /chat/messages
 * response, and checks the one thing that actually matters: does the reply
 * give the user a way forward (a real follow-up question, or an explicit
 * "something's wrong"), or does it strand them exactly like the recorded
 * bug -- a card withheld correctly, but nothing said about why.
 *
 * The unit half (calling `buildPending` directly) stays unimplemented and
 * reported blocked -- it isn't exported from chatSlice.ts, and touching
 * client/ this run is out of scope pending Adam's answer on delegation.
 */
test("FR-05 each buildPending rejection branch is reported, not silently dropped", async ({ page }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  const rejectionCases = [
    // Missing amount/category: buildPending returns null because a draft's
    // amount or category is null -- the realistic follow-up asks for it.
    { name: "missing category", reply: "Got it, ₪20 -- which category should that go under?", drafts: [{ amount: 20 }] },
    { name: "missing amount", reply: "How much did you spend on that?", drafts: [{ category: "Food" }] },
    // Over-long / JSON-fragment store: buildPending rejects on !isSaneText,
    // but the AI's own reply (as actually observed) claims everything is
    // fine and asks nothing further -- the real gap FR-05 exists to catch.
    { name: "over-long store", reply: "Got it, ₪20 under Food.", drafts: [{ amount: 20, category: "Food", store: "x".repeat(250) }] },
    {
      name: "JSON-fragment store",
      reply: "Got it, ₪20 under Food.",
      drafts: [{ amount: 20, category: "Food", store: '{"amount":20,"category":"Food"}' }],
    },
  ];

  for (const { name, reply, drafts } of rejectionCases) {
    await page.route("**/chat/messages", (route) =>
      route.fulfill({ status: 200, json: { intent: "create-expense", reply, drafts } }),
    );
    await sendChat(page, `trigger ${name}`);
    await expect(userBubble(page, `trigger ${name}`)).toBeVisible({ timeout: 10_000 });

    // buildPending must actually withhold the card for every one of these
    // shapes (amount/category missing, or an unsane store) -- if a Confirm
    // button appears here, buildPending's rejection logic itself is broken.
    await expect(confirmButton(page), `FR-05 (${name}): a Confirm button appeared for a shape buildPending must reject`).toHaveCount(0);

    const lastReply = (await assistantBubble(page).last().innerText()).trim();
    const givesAWayForward = /\?$/.test(lastReply) || /problem|couldn'?t|invalid|error|try again|didn'?t (?:catch|understand)|not sure/i.test(lastReply);
    expect(
      givesAWayForward,
      `FR-05 (${name}): no Confirm button (correct) but the reply gives the user no way forward: "${lastReply}"`,
    ).toBe(true);

    await page.unroute("**/chat/messages");
  }
});

test("FR-06 cancel leaves a visible, durable record", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  await sendChat(page, "spent 20 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await cancelButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0);

  await page.reload();

  const accessToken = await accessTokenFor(context, API_BASE);
  const expenses = await getExpenses(API_BASE, accessToken);
  expect(expenses).toHaveLength(0);

  // C5: the transcript should show an explicit cancelled outcome that
  // survives the reload -- not just silence where the draft used to be.
  const bubbleTexts = await assistantBubble(page).allInnerTexts();
  const recordsCancellation = bubbleTexts.some((t) => /cancel/i.test(t));
  expect(recordsCancellation, "FR-06: no message in the transcript records that the draft was cancelled").toBe(true);
});

test("FR-07 the four outcomes are distinguishable (pairwise)", async ({ page }) => {
  test.setTimeout(150_000);
  const user = makeUser();
  await signUpThroughUI(page, user);

  async function lastAssistantText(): Promise<string> {
    return (await page.locator(".chat-bubble--assistant").last().innerText()).trim();
  }

  // Outcome 1: confirmed.
  await sendChat(page, "spent 11 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await confirmButton(page).click();
  await expect(confirmButton(page)).toHaveCount(0, { timeout: 10_000 });
  const confirmed = await lastAssistantText();

  // Outcome 2: cancelled.
  await sendChat(page, "spent 12 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await cancelButton(page).click();
  const cancelled = await lastAssistantText();

  // Outcome 3: reloaded away (discarded).
  await sendChat(page, "spent 13 on coffee");
  await expect(confirmButton(page)).toBeVisible(AI_WAIT);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const reloaded = await lastAssistantText();

  // Outcome 4: a genuinely MALFORMED DRAFT -- qa-lead's review: "asdkjhasd"
  // is nonsense input (Group 7/FR-31's class, "no intent recognised"), a
  // different class from a malformed draft (an incomplete/unsane
  // create-expense buildPending must reject, Group 1's own class). Forced
  // deterministically via a stub so this outcome doesn't depend on the real
  // model happening to produce an unusable shape.
  await page.route("**/chat/messages", (route) =>
    route.fulfill({ status: 200, json: { intent: "create-expense", reply: "Got it, ₪14 under Food.", drafts: [{ amount: 14, category: "Food", store: '{"broken":true}' }] } }),
  );
  await sendChat(page, "spent 14 somewhere odd");
  await expect(userBubble(page, "spent 14 somewhere odd")).toBeVisible({ timeout: 10_000 });
  const broken = await lastAssistantText();

  const outcomes: [string, string][] = [
    ["confirmed", confirmed],
    ["cancelled", cancelled],
    ["reloaded", reloaded],
    ["broken", broken],
  ];
  const collisions: string[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    for (let j = i + 1; j < outcomes.length; j++) {
      if (outcomes[i][1] === outcomes[j][1]) {
        collisions.push(`${outcomes[i][0]} == ${outcomes[j][0]}: "${outcomes[i][1]}"`);
      }
    }
  }
  expect(collisions, `FR-07: every pair of outcomes must differ; collisions found: ${JSON.stringify(collisions)}`).toEqual([]);
});
