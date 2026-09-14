/**
 * API tests for POST /users/signup
 * Test spec: qa/specs/api-signup.md  (SU-01 .. SU-12)
 * Governing spec: docs/specs/03-api-contract.md §0-§1; 05-user-layers.md §5-§8, §10 d4.
 *
 * Real HTTP against the spawned server (harness/globalSetup.ts) on :3100,
 * real Mongo (expenses_qa_test). The harness drops the DB at the end.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { AuthSuccess, ValidationError, GeneralError } from "../../fixtures/schemas.js";
import { makeUser, signup, safeJson, extractCookiePair, parseCookieAttrs, containsSecret } from "../../fixtures/factories.js";

useServer();

const url = `${TEST_BASE_URL}/users/signup`;
const post = (body: any) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /users/signup", () => {
  it("SU-01 valid signup returns 201", async () => {
    const r = await signup();
    expect(r.status).toBe(201);
  });

  it("SU-02 success body matches AuthSuccess exactly (no extra keys)", async () => {
    const r = await signup();
    const parsed = AuthSuccess.safeParse(r.body);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    expect(Object.keys(r.body).sort()).toEqual(["accessToken", "user"]);
    expect(Object.keys(r.body.user).sort()).toEqual(["email", "id", "username"]);
  });

  it("SU-03 body contains no password and no bcrypt hash", async () => {
    const r = await signup();
    const hit = containsSecret(JSON.stringify(r.body));
    expect(hit.hit, hit.what).toBe(false);
  });

  it("SU-04 body contains no createdAt", async () => {
    const r = await signup();
    expect(r.body.user).not.toHaveProperty("createdAt");
  });

  it("SU-05 body contains no refreshToken", async () => {
    const r = await signup();
    expect(JSON.stringify(r.body)).not.toContain("refreshToken");
  });

  it("SU-06 Set-Cookie sets an HttpOnly refreshToken with the right attributes", async () => {
    const r = await signup();
    const attrs = parseCookieAttrs(r.setCookie, "refreshToken");
    expect(attrs, "refreshToken cookie present").toBeTruthy();
    expect(attrs!["httponly"]).toBe(true);
    expect(String(attrs!["samesite"]).toLowerCase()).toBe("lax");
    expect(String(attrs!["max-age"])).toBe("604800");
    expect(attrs!["path"]).toBe("/");
    expect(attrs!["secure"]).toBeUndefined();
  });

  it("SU-07 user.id is a 24-hex ObjectId; username/email echo the request (email lowercased)", async () => {
    const u = makeUser();
    const r = await signup(u);
    expect(r.body.user.id).toMatch(/^[a-f0-9]{24}$/);
    expect(r.body.user.username).toBe(u.username);
    expect(r.body.user.email).toBe(u.email.toLowerCase());
  });

  it("SU-08 username shorter than 3 -> 400 with the errors shape, field 'username'", async () => {
    const u = makeUser({ username: "ab" });
    const res = await post(u);
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(ValidationError.safeParse(body).success).toBe(true);
    expect(body.errors.some((e: any) => e.field === "username")).toBe(true);
    expect(body).not.toHaveProperty("error");
  });

  it("SU-09 invalid email -> 400, field 'email'", async () => {
    const res = await post(makeUser({ email: "nope" }));
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(body.errors.some((e: any) => e.field === "email")).toBe(true);
  });

  it("SU-10 password shorter than 8 -> 400, field 'password'", async () => {
    const res = await post(makeUser({ password: "short" }));
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(body.errors.some((e: any) => e.field === "password")).toBe(true);
  });

  it("SU-11 every field in a multi-error response matches a body key exactly", async () => {
    const res = await post({ username: "ab", email: "nope", password: "x" });
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    const fields = new Set(body.errors.map((e: any) => e.field));
    for (const f of fields) expect(["username", "email", "password"]).toContain(f);
  });

  it("SU-12 duplicate username -> 400 (async validator) OR 409 (unique-index race), always a valid shape", async () => {
    const first = makeUser();
    await signup(first);
    const res = await post({ ...makeUser(), username: first.username });
    expect([400, 409]).toContain(res.status);
    const body = await safeJson(res);
    if (res.status === 400) {
      expect(ValidationError.safeParse(body).success).toBe(true);
      expect(body.errors.some((e: any) => e.field === "username")).toBe(true);
    } else {
      expect(GeneralError.safeParse(body).success).toBe(true);
    }
    expect(containsSecret(JSON.stringify(body)).hit).toBe(false);
  });
});
