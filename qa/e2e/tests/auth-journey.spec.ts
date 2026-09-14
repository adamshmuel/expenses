import { test, expect } from "@playwright/test";
import { makeUser, signup } from "../../fixtures/factories.js";

// UJ-01 — sign up, land logged in, survive a reload, log out.
// Spec: qa/specs/e2e-auth-journey.md. Governed by 01-ai-chat.md §1/§4,
// 03-api-contract.md §1, 05-user-layers.md §4/§6.
test("UJ-01 sign up lands on /home, survives a reload, logout ends the session", async ({ page }) => {
  const user = makeUser();

  await page.goto("/signup");
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText(user.username, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);

  // The access token must live only in memory -- never localStorage.
  const storageDump = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(storageDump.toLowerCase()).not.toContain("token");

  // Reload: the in-memory access token is gone. Only the refreshToken cookie
  // (HttpOnly, set by the server) can bring the session back.
  await page.reload();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText(user.username, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

  // Logout must be real (server-side), not just a client-side redirect.
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login$/);
});

// UJ-02 — wrong password shows the generic message, then the right one works.
// Spec: qa/specs/e2e-auth-journey.md. Mirrors LI-07 at the browser layer.
test("UJ-02 wrong password shows the generic message; the right one then works", async ({ page }) => {
  const { user } = await signup();

  await page.goto("/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("alert")).toHaveText("Username or password is incorrect.");

  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/home$/);
});
