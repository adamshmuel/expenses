/**
 * API tests for POST /users/logout
 * Test spec: qa/specs/api-logout.md  (LO-01 .. LO-05)
 * Governing spec: docs/specs/03-api-contract.md §1; 05-user-layers.md §6 /logout.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { signupAndGetCookie, parseCookieAttrs, readSetCookie } from "../../fixtures/factories.js";

useServer();

const logout = (cookie?: string) =>
  fetch(`${TEST_BASE_URL}/users/logout`, { method: "POST", headers: cookie ? { Cookie: cookie } : {} });
const refresh = (cookie: string) =>
  fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST", headers: { Cookie: cookie } });

describe("POST /users/logout", () => {
  it("LO-01 logout returns 204 with no body", async () => {
    const { cookie } = await signupAndGetCookie();
    const res = await logout(cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("LO-02 logout clears the refreshToken cookie", async () => {
    const { cookie } = await signupAndGetCookie();
    const res = await logout(cookie);
    const setCookies = res.headers.getSetCookie?.() ?? readSetCookie(res);
    const attrs = parseCookieAttrs(setCookies, "refreshToken");
    expect(attrs, "a refreshToken clear directive is present").toBeTruthy();
    const cleared =
      attrs!["__value"] === "" ||
      "expires" in attrs! ||
      attrs!["max-age"] === "0";
    expect(cleared).toBe(true);
  });

  it("LO-03 after logout the old refresh token no longer works on /refresh", async () => {
    const { cookie } = await signupAndGetCookie();
    await logout(cookie);
    const res = await refresh(cookie);
    expect(res.status).toBe(401);
  });

  it("LO-04 logout with no cookie is still 204 (safe / idempotent)", async () => {
    const res = await logout();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("LO-05 logout twice with the same cookie is safe", async () => {
    const { cookie } = await signupAndGetCookie();
    const a = await logout(cookie);
    const b = await logout(cookie);
    expect(a.status).toBe(204);
    expect(b.status).toBe(204);
  });
});
