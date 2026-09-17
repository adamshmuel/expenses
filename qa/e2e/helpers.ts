/**
 * Shared browser + API helpers for the fresh-account (FR-/XS-/BD-) and
 * lived-in (LV-) Playwright specs. Extracted from the patterns already
 * proven in chat-stress-flows.spec.ts / chat-dashboard-journey.spec.ts so
 * every new spec file cites the same helpers instead of re-inventing them.
 */
import { type Page, type BrowserContext, expect } from "@playwright/test";
import { makeUser, safeJson, type NewUser } from "../fixtures/factories.js";

export const AI_WAIT = { timeout: 45_000 };

export function apiBaseFor(port: number) {
  return `http://127.0.0.1:${port}`;
}

export async function signUpThroughUI(page: Page, user: NewUser) {
  await page.goto("/signup");
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

export async function logInThroughUI(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

export async function sendChat(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

/** Scoped to `.chat-bubble--user` -- the assistant sometimes echoes the
 *  user's own words back, which makes an unscoped locator ambiguous
 *  (found while writing FS-04; see chat-stress-flows.spec.ts). */
export function userBubble(page: Page, text: string) {
  return page.locator(".chat-bubble--user").filter({ hasText: text });
}
export function assistantBubble(page: Page) {
  return page.locator(".chat-bubble--assistant");
}
export function confirmButton(page: Page) {
  return page.getByRole("button", { name: "Confirm" });
}
export function cancelButton(page: Page) {
  return page.getByRole("button", { name: "Cancel" });
}

/** Mints a fresh access token from this browser session's own refresh
 *  cookie -- proves a save really happened server-side, not just in
 *  optimistic UI state (the pattern FJ-01 and the FS-* suite use). */
export async function accessTokenFor(context: BrowserContext, apiBase: string): Promise<string> {
  const cookies = await context.cookies();
  const refreshCookie = cookies.find((c) => c.name === "refreshToken");
  expect(refreshCookie, "browser session must have a refreshToken cookie").toBeTruthy();
  const res = await fetch(`${apiBase}/users/refresh`, {
    method: "POST",
    headers: { Cookie: `refreshToken=${refreshCookie!.value}` },
  });
  const body = await safeJson(res);
  return body.accessToken as string;
}

export async function apiGet(apiBase: string, path: string, accessToken: string) {
  const res = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { status: res.status, body: await safeJson(res) };
}

export async function apiPost(apiBase: string, path: string, accessToken: string, body: unknown) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await safeJson(res) };
}

export async function getExpenses(apiBase: string, accessToken: string) {
  return (await apiGet(apiBase, "/expenses", accessToken)).body;
}
export async function getCategories(apiBase: string, accessToken: string) {
  return (await apiGet(apiBase, "/categories", accessToken)).body;
}
export async function getMessages(apiBase: string, accessToken: string) {
  return (await apiGet(apiBase, "/chat/messages", accessToken)).body;
}
export async function getSummary(apiBase: string, accessToken: string, from?: string, to?: string) {
  const qs = from && to ? `?from=${from}&to=${to}` : "";
  return (await apiGet(apiBase, `/expenses/summary${qs}`, accessToken)).body;
}

/** A save-claim scanner for FR-02/C2 -- assistant prose that asserts
 *  something was recorded ("I have saved...", "Done", "recorded", "filed",
 *  "added"). Deliberately generous: false positives just mean an extra row
 *  is checked for, never a missed one. */
const SAVE_CLAIM_PATTERN = /\b(saved|recorded|filed|added|logged|done)\b/i;
export function looksLikeSaveClaim(text: string): boolean {
  return SAVE_CLAIM_PATTERN.test(text);
}

/** Decodes the (unverified) payload of a JWT access token -- `{ id, username }`
 *  per unit-userService.md. Test-only convenience to check a `user` field
 *  against the logged-in user's real id; never used for anything security-
 *  relevant. */
export function decodeAccessToken(token: string): { id: string; username: string } {
  const payload = token.split(".")[1];
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return JSON.parse(json);
}

/** Records a real model call's raw response to stdout, tagged so the report
 *  builder (qa/scripts/build-report.mjs) can surface it under the failing
 *  case without anyone having to pay to re-run it (coordinator instruction,
 *  2026-09-16 run). Playwright's JSON reporter captures per-test stdout. */
export function logAIRaw(caseId: string, label: string, body: unknown): void {
  console.log(`[AI-RAW ${caseId} ${label}] ${JSON.stringify(body)}`);
}

export { makeUser };
export type { NewUser };
