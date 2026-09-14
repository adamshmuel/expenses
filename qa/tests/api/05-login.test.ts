/**
 * API tests for POST /users/login
 * Test spec: qa/specs/api-login.md  (LI-01 .. LI-09)
 * Governing spec: docs/specs/03-api-contract.md §1; 05-user-layers.md §6/§7/§8.
 *
 * RUNS LAST among the API files. The strict /login limiter is 5 attempts /
 * 15 min / IP and is process-global + in-memory, so this file restarts the
 * server before each describe block to get a clean 5-attempt budget, and the
 * 429 block is last.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { restartServer } from "../../harness/server.js";
import { useServer } from "../../harness/useServer.js";
import { sleep } from "../../harness/server.js";
import { AuthSuccess, ValidationError, GeneralError } from "../../fixtures/schemas.js";
import { makeUser, signup, safeJson, parseCookieAttrs, readSetCookie, containsSecret } from "../../fixtures/factories.js";

useServer();

const url = `${TEST_BASE_URL}/users/login`;
const post = (body: any) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /users/login — success shape", () => {
  // Each test logs in as its OWN fresh user. Two logins by the SAME user within
  // the same wall-clock second produce an identical refresh-token JWT (payload
  // is just { userId }, and jwt `iat` is second-resolution), which collides on
  // the RefreshToken.token unique index and surfaces as a 409. See FINDING F-1
  // in the run report. Using a distinct user per test isolates the shape checks
  // from that timing bug.
  beforeAll(async () => {
    await restartServer();
  });

  it("LI-01 valid credentials return 200", async () => {
    const u = makeUser();
    await signup(u);
    await sleep(1100); // avoid the F-1 same-second refresh-token collision
    const res = await post({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
  });

  it("LI-02 success body matches AuthSuccess exactly and equals signup's shape", async () => {
    const u = makeUser();
    await signup(u);
    await sleep(1100); // avoid the F-1 same-second refresh-token collision
    const res = await post({ username: u.username, password: u.password });
    const body = await safeJson(res);
    expect(AuthSuccess.safeParse(body).success).toBe(true);
    expect(Object.keys(body).sort()).toEqual(["accessToken", "user"]);
    expect(Object.keys(body.user).sort()).toEqual(["email", "id", "username"]);
  });

  it("LI-03 login sets a fresh HttpOnly refreshToken cookie", async () => {
    const u = makeUser();
    await signup(u);
    await sleep(1100); // avoid the F-1 same-second refresh-token collision
    const res = await post({ username: u.username, password: u.password });
    const setCookies = res.headers.getSetCookie?.() ?? readSetCookie(res);
    const attrs = parseCookieAttrs(setCookies, "refreshToken");
    expect(attrs).toBeTruthy();
    expect(attrs!["httponly"]).toBe(true);
    expect(String(attrs!["samesite"]).toLowerCase()).toBe("lax");
    expect(String(attrs!["max-age"])).toBe("604800");
    expect(attrs!["path"]).toBe("/");
  });

  it("LI-04 no password / hash / refreshToken in the body", async () => {
    const u = makeUser();
    await signup(u);
    await sleep(1100); // avoid the F-1 same-second refresh-token collision
    const res = await post({ username: u.username, password: u.password });
    const body = await safeJson(res);
    expect(containsSecret(JSON.stringify(body)).hit).toBe(false);
    expect(JSON.stringify(body)).not.toContain("refreshToken");
  });
});

describe("POST /users/login — validation", () => {
  beforeAll(async () => { await restartServer(); });

  it("LI-05 missing username -> 400 with the errors shape", async () => {
    const res = await post({ password: "password123" });
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(ValidationError.safeParse(body).success).toBe(true);
    expect(body.errors.some((e: any) => e.field === "username")).toBe(true);
    expect(body).not.toHaveProperty("error");
  });

  it("LI-06 missing password -> 400", async () => {
    const res = await post({ username: "whoever" });
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(body.errors.some((e: any) => e.field === "password")).toBe(true);
  });
});

describe("POST /users/login — generic 401", () => {
  let known: ReturnType<typeof makeUser>;
  beforeAll(async () => {
    await restartServer();
    known = makeUser();
    await signup(known);
  });

  it("LI-07 wrong password and unknown username produce the IDENTICAL 401 body", async () => {
    const a = await post({ username: known.username, password: "definitely-wrong" });
    const b = await post({ username: "no-such-user-xyz", password: "whatever12" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const aBody = await safeJson(a);
    const bBody = await safeJson(b);
    expect(aBody).toEqual({ error: "Username or password is incorrect." });
    expect(bBody).toEqual(aBody);
    expect((a.headers.getSetCookie?.() ?? readSetCookie(a)).join(";")).not.toContain("refreshToken=");
  });
});

describe("POST /users/login — finding F-1: same-second re-login collision", () => {
  beforeAll(async () => { await restartServer(); });

  it("LI-10 two logins by the same user within one second: the second returns 409 [FINDING]", async () => {
    // FINDING F-1 (not a spec assertion): issueTokenPair signs the refresh token
    // as jwt.sign({ userId }, REFRESH_TOKEN_SECRET, { expiresIn: '7d' }). Within
    // the same wall-clock second the payload AND the `iat` are identical, so the
    // token STRING is identical; saveRefreshToken then violates the unique index
    // on RefreshToken.token and errorHandler maps E11000 -> 409. A user who
    // double-submits the login form, or logs in twice quickly, gets a 409.
    // This test PASSES by confirming the current behaviour so the finding is
    // visible in the report; it is a bug to fix (e.g. add a jti/nonce to the
    // refresh payload) or a spec note to add.
    const u = makeUser();
    await signup(u); // consumes 1 refresh row for this user
    const first = await post({ username: u.username, password: u.password });
    const second = await post({ username: u.username, password: u.password });
    // At least one of the two rapid logins collides on the unique token index.
    const statuses = [first.status, second.status];
    expect(statuses).toContain(409);
    // And the 409 still uses the agreed general error shape.
    const collided = first.status === 409 ? first : second;
    expect(GeneralError.safeParse(await safeJson(collided)).success).toBe(true);
  });
});

describe("POST /users/login — strict rate limit", () => {
  let fresh: ReturnType<typeof makeUser>;
  beforeAll(async () => {
    await restartServer();
    fresh = makeUser();
    await signup(fresh);
  });

  it("LI-08 the 6th login attempt in the window returns 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await post({ username: fresh.username, password: "wrong-pass-xx" });
      statuses.push(r.status);
    }
    const sixth = await post({ username: fresh.username, password: "wrong-pass-xx" });
    statuses.push(sixth.status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(sixth.status).toBe(429);
    const body = await safeJson(sixth);
    expect(typeof body.error).toBe("string");
  });

  it("LI-09 a 429 from the login limiter uses the general error shape", async () => {
    // still tripped from LI-08 (same window, same IP)
    const res = await post({ username: "anyone", password: "anything12" });
    expect(res.status).toBe(429);
    expect(GeneralError.safeParse(await safeJson(res)).success).toBe(true);
  });
});
