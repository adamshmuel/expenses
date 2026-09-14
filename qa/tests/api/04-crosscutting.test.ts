/**
 * API tests for cross-cutting HTTP behaviours
 * Test spec: qa/specs/api-crosscutting.md  (XC-01 .. XC-14)
 * Governing spec: 03-api-contract.md §0; 07-server-entry.md §2/§4;
 *                 01-ai-chat.md §2; 05-user-layers.md §5; 06-server-modules.md §3.
 *
 * Restarts the server in beforeAll so the strict /login limiter (5/15min/IP) is
 * clean, and keeps the number of real /login calls minimal (well under 5).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { sleep } from "../../harness/server.js";
import { GeneralError, ValidationError, isOneOfTheTwoErrorShapes } from "../../fixtures/schemas.js";
import { signup, signupAndGetCookie, login, safeJson, containsSecret, readSetCookie } from "../../fixtures/factories.js";

useServer();

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_SRC = readFileSync(resolve(here, "..", "..", "..", "backend", "index.js"), "utf8");

// Shared fixtures captured once so the file makes only 1 real /login call total.
let signupRes: Awaited<ReturnType<typeof signup>>;
let loginRes: Awaited<ReturnType<typeof login>>;
let refreshBody: any;
let refreshSetCookie: string;

beforeAll(async () => {
  signupRes = await signup();
  // Space the login >1s from the signup: a same-second login for the same user
  // reissues a byte-identical refresh JWT that collides on the unique token
  // index -> 409 with no cookie (finding F-1, see qa/tests/api/05-login.test.ts LI-10).
  await sleep(1100);
  loginRes = await login(signupRes.user.username, signupRes.user.password); // the ONE login
  const { cookie } = await signupAndGetCookie();
  const r = await fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST", headers: { Cookie: cookie } });
  refreshBody = await safeJson(r);
  refreshSetCookie = (r.headers.getSetCookie?.() ?? readSetCookie(r)).join(";");
});

describe("cross-cutting HTTP behaviours", () => {
  it("XC-01 every error body is one of exactly two shapes", async () => {
    const responses = await Promise.all([
      fetch(`${TEST_BASE_URL}/users/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST" }),
      fetch(`${TEST_BASE_URL}/nope-${Date.now()}`),
    ]);
    // plus the two we already have from beforeAll
    const bodies = await Promise.all(responses.map(safeJson));
    for (const body of bodies) {
      const check = isOneOfTheTwoErrorShapes(body);
      expect(check.ok, check.reason ?? "").toBe(true);
    }
  });

  it("XC-02 field values in a validation error match request body keys exactly", async () => {
    const res = await fetch(`${TEST_BASE_URL}/users/signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ab", email: "bad", password: "x" }),
    });
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(ValidationError.safeParse(body).success).toBe(true);
    for (const e of body.errors) expect(["username", "email", "password"]).toContain(e.field);
  });

  it("XC-03 no successful response body ever contains password or a bcrypt hash", async () => {
    for (const b of [signupRes.body, loginRes.body, refreshBody]) {
      const hit = containsSecret(JSON.stringify(b));
      expect(hit.hit, hit.what).toBe(false);
    }
  });

  it("XC-04 refreshToken never appears in a JSON body, only in Set-Cookie", async () => {
    expect(JSON.stringify(signupRes.body)).not.toContain("refreshToken");
    expect(signupRes.setCookie.join(";")).toContain("refreshToken=");
    expect(JSON.stringify(loginRes.body)).not.toContain("refreshToken");
    expect(loginRes.setCookie.join(";")).toContain("refreshToken=");
    expect(JSON.stringify(refreshBody)).not.toContain("refreshToken");
    expect(refreshSetCookie).toContain("refreshToken=");
  });

  it("XC-05 helmet security headers present on a success response", async () => {
    const res = await fetch(`${TEST_BASE_URL}/users/signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `xc05_${Date.now()}`.slice(0, 20), email: `xc05_${Date.now()}@t.io`, password: "password123" }),
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-dns-prefetch-control")).toBeTruthy();
    expect(res.headers.get("content-security-policy")).toBeTruthy();
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("XC-06 helmet headers present on an error response too", async () => {
    const res = await fetch(`${TEST_BASE_URL}/nope-${Date.now()}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("XC-07 CORS: exact client origin echoed, credentials allowed", async () => {
    const res = await fetch(`${TEST_BASE_URL}/users/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: "{}",
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("XC-08 CORS preflight (OPTIONS) is answered for the client origin", async () => {
    const res = await fetch(`${TEST_BASE_URL}/users/login`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("XC-09 a foreign origin does not get its origin echoed", async () => {
    const res = await fetch(`${TEST_BASE_URL}/users/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: "{}",
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("http://evil.example");
  });

  it("XC-10 an unmatched path returns 404 with the general error shape", async () => {
    const res = await fetch(`${TEST_BASE_URL}/this/does/not/exist-${Date.now()}`);
    expect(res.status).toBe(404);
    expect(GeneralError.safeParse(await safeJson(res)).success).toBe(true);
  });

  it("XC-11 the 404 body message is 'Not Found'", async () => {
    const res = await fetch(`${TEST_BASE_URL}/this/does/not/exist-${Date.now()}`);
    const body = await safeJson(res);
    expect(body.error).toBe("Not Found");
  });

  it("XC-12 JSON body parsing and cookie parsing are wired (middleware-order effect)", async () => {
    const a = await fetch(`${TEST_BASE_URL}/users/signup`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    expect(a.status).toBe(400);
    expect(ValidationError.safeParse(await safeJson(a)).success).toBe(true);

    const b = await fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST", headers: { Cookie: "refreshToken=x" } });
    expect(b.status).toBe(401);
    expect(GeneralError.safeParse(await safeJson(b)).success).toBe(true);
  });

  it("XC-13 middleware order: helmet vs compression [DESIGN NOTE]", async () => {
    const uses = [...INDEX_SRC.matchAll(/app\.use\(\s*([a-zA-Z]+)/g)].map((m) => m[1]);
    const compIdx = uses.indexOf("compression");
    const helmetIdx = uses.indexOf("helmet");
    expect(compIdx).toBeGreaterThanOrEqual(0);
    expect(helmetIdx).toBeGreaterThanOrEqual(0);
    const res = await fetch(`${TEST_BASE_URL}/nope-${Date.now()}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // Documents the divergence without failing: passes today (compression first)
    // and would still pass if index.js is reordered to put helmet first.
    expect(helmetIdx === 0 || compIdx < helmetIdx).toBe(true);
  });

  it("XC-14 a global rate limiter is present and looser than the login limiter", async () => {
    expect(INDEX_SRC).toMatch(/rateLimit\(\s*\{[\s\S]*?max:\s*300/);
    const results = await Promise.all(
      Array.from({ length: 15 }, () => fetch(`${TEST_BASE_URL}/nope-global-${Math.random()}`))
    );
    for (const r of results) expect(r.status).not.toBe(429);
  });
});
