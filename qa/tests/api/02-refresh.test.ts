/**
 * API tests for POST /users/refresh
 * Test spec: qa/specs/api-refresh.md  (RF-01 .. RF-09)
 * Governing spec: docs/specs/03-api-contract.md §1; 05-user-layers.md §6/§8;
 *                 04-data-model.md "RefreshToken"; 06-server-modules.md §3.3.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEST_BASE_URL, BACKEND_LOGS } from "../../harness/paths.js";
import { sleep } from "../../harness/server.js";
import { useServer } from "../../harness/useServer.js";
import { AuthSuccess, GeneralError } from "../../fixtures/schemas.js";
import { signupAndGetCookie, safeJson, parseCookieAttrs, extractCookiePair, readSetCookie, containsSecret } from "../../fixtures/factories.js";
import { readBackendEnv, deriveTestMongoUri } from "../../harness/env.js";

useServer();

const url = `${TEST_BASE_URL}/users/refresh`;
const postCookie = (cookie?: string) =>
  fetch(url, { method: "POST", headers: cookie ? { Cookie: cookie } : {} });

let conn: mongoose.Connection;
beforeAll(async () => {
  const be = readBackendEnv();
  conn = await mongoose.createConnection(deriveTestMongoUri(be.MONGODB_URI)).asPromise();
});
afterAll(async () => { await conn?.close(); });

const errorLogPath = resolve(BACKEND_LOGS, "error.log");
const errorLogSize = () => { try { return statSync(errorLogPath).size; } catch { return 0; } };

describe("POST /users/refresh", () => {
  it("RF-01 no cookie -> 401 with the general error shape", async () => {
    const res = await postCookie();
    expect(res.status).toBe(401);
    const body = await safeJson(res);
    expect(GeneralError.safeParse(body).success).toBe(true);
  });

  it("RF-02 the no-cookie 401 is NOT written to logs/error.log", async () => {
    const before = errorLogSize();
    await postCookie();
    await new Promise((r) => setTimeout(r, 400));
    const after = errorLogSize();
    if (after > before) {
      const added = readFileSync(errorLogPath, "utf8").slice(before);
      expect(added).not.toMatch(/\/users\/refresh/);
      expect(added).not.toMatch(/\[ERROR\]/);
    } else {
      expect(after).toBe(before);
    }
  });

  it("RF-03 a valid cookie -> 200 with { user, accessToken }", async () => {
    const { cookie } = await signupAndGetCookie();
    const res = await postCookie(cookie);
    expect(res.status).toBe(200);
    const body = await safeJson(res);
    expect(AuthSuccess.safeParse(body).success).toBe(true);
    expect(containsSecret(JSON.stringify(body)).hit).toBe(false);
    expect(JSON.stringify(body)).not.toContain("refreshToken");
  });

  it("RF-04 refresh issues a NEW refresh cookie (rotation)", async () => {
    const { cookie } = await signupAndGetCookie();
    const sentValue = cookie.split("=")[1];
    // jwt timestamps are second-resolution; wait so the rotated token's `iat`
    // differs from the one just issued (otherwise identical payload+secret ->
    // identical token string, which would hide the rotation).
    await sleep(1100);
    const res = await postCookie(cookie);
    const setCookies = res.headers.getSetCookie?.() ?? readSetCookie(res);
    const newPair = extractCookiePair(setCookies, "refreshToken");
    expect(newPair).toBeTruthy();
    expect(newPair!.split("=")[1]).not.toBe(sentValue);
    const attrs = parseCookieAttrs(setCookies, "refreshToken")!;
    expect(attrs["httponly"]).toBe(true);
    expect(String(attrs["max-age"])).toBe("604800");
  });

  it("RF-05 the previous refresh token stops working after one rotation", async () => {
    const { cookie: c1 } = await signupAndGetCookie();
    await sleep(1100); // ensure the rotated token is a distinct string
    const first = await postCookie(c1);
    expect(first.status).toBe(200);
    const setCookies = first.headers.getSetCookie?.() ?? readSetCookie(first);
    const c2 = extractCookiePair(setCookies, "refreshToken")!;

    const reuse = await postCookie(c1);
    expect(reuse.status).toBe(401);
    const reuseCookies = reuse.headers.getSetCookie?.() ?? readSetCookie(reuse);
    // cookie cleared
    const cleared = parseCookieAttrs(reuseCookies, "refreshToken");
    expect(cleared === null || cleared["__value"] === "" || "expires" in cleared || cleared["max-age"] === "0").toBeTruthy();

    const withC2 = await postCookie(c2);
    expect(withC2.status).toBe(200);
  });

  it("RF-06 a tampered cookie -> 401 and the cookie is cleared", async () => {
    const { cookie } = await signupAndGetCookie();
    const [name, val] = cookie.split("=");
    const tampered = `${name}=${val.slice(0, -1)}${val.slice(-1) === "a" ? "b" : "a"}`;
    const res = await postCookie(tampered);
    expect(res.status).toBe(401);
    expect(GeneralError.safeParse(await safeJson(res)).success).toBe(true);
    const setCookies = res.headers.getSetCookie?.() ?? readSetCookie(res);
    const cleared = parseCookieAttrs(setCookies, "refreshToken");
    expect(cleared === null || cleared["__value"] === "" || "expires" in cleared || cleared["max-age"] === "0").toBeTruthy();
  });

  it("RF-07 the RefreshToken collection grows by net zero per rotation", async () => {
    const { cookie, user } = await signupAndGetCookie();
    const before = await conn.collection("refreshtokens").countDocuments();
    const res = await postCookie(cookie);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const after = await conn.collection("refreshtokens").countDocuments();
    expect(after).toBe(before);
    const userDoc = await conn.collection("users").findOne({ username: user.username });
    const forUser = await conn.collection("refreshtokens").countDocuments({ user: userDoc!._id });
    expect(forUser).toBe(1);
  });

  it("RF-08 refresh returns the correct user", async () => {
    const { cookie, user } = await signupAndGetCookie();
    const res = await postCookie(cookie);
    const body = await safeJson(res);
    expect(body.user.username).toBe(user.username);
    expect(body.user.email).toBe(user.email.toLowerCase());
    expect(body.user.id).toMatch(/^[a-f0-9]{24}$/);
  });

  it("RF-09 an unknown but well-formed token -> 401", async () => {
    const be = readBackendEnv();
    const token = jwt.sign({ userId: new mongoose.Types.ObjectId().toString() }, be.REFRESH_TOKEN_SECRET, { expiresIn: "7d" });
    const res = await postCookie(`refreshToken=${token}`);
    expect(res.status).toBe(401);
    expect(GeneralError.safeParse(await safeJson(res)).success).toBe(true);
  });
});
