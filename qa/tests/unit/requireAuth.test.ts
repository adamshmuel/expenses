/**
 * Unit tests for backend/middleware/requireAuth.js
 * Test spec: qa/specs/unit-requireAuth.md  (RA-01 .. RA-09)
 * Governing spec: docs/specs/06-server-modules.md §4.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const requireBackend = createRequire(resolve(BACKEND, "package.json"));
const REQUIRE_AUTH_SRC = resolve(BACKEND, "middleware/requireAuth.js");

const SECRET = "test-access-secret";
let requireAuth: any;

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const validToken = () => jwt.sign({ id: "u1", username: "amir" }, SECRET, { expiresIn: "15m" });

beforeEach(() => {
  vi.resetModules();
  process.env.JWT_SECRET = SECRET;
  requireAuth = requireBackend("./middleware/requireAuth.js");
});

describe("middleware/requireAuth.js", () => {
  it("RA-01 no Authorization header -> 401, next not called", () => {
    const req: any = { headers: {} };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Not authenticated." });
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("RA-02 header not 'Bearer ' -> 401, next not called", () => {
    const req: any = { headers: { authorization: "Token abc123" } };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Not authenticated." });
    expect(next).not.toHaveBeenCalled();
  });

  it("RA-03 'Bearer ' with empty token -> 401, next not called", () => {
    // "Bearer " passes the startsWith check, so an empty token reaches jwt.verify,
    // which throws -> the catch answers 401. The message-string divergence is
    // asserted once, in RA-06; here we only check the status + no-next behaviour,
    // which the code gets right.
    const req: any = { headers: { authorization: "Bearer " } };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("RA-04 valid token -> req.user is exactly { id, username }, next() once", () => {
    const req: any = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: "u1", username: "amir" });
    expect(Object.keys(req.user).sort()).toEqual(["id", "username"]);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("RA-05 expired token -> 401, next not called", () => {
    const expired = jwt.sign({ id: "u1", username: "amir" }, SECRET, { expiresIn: -10 });
    const req: any = { headers: { authorization: `Bearer ${expired}` } };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("RA-06 verify-failure body must be { error: 'Invalid or expired token!' }", () => {
    const tampered = jwt.sign({ id: "u1", username: "amir" }, "wrong-secret");
    const req: any = { headers: { authorization: `Bearer ${tampered}` } };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token!" });
  });

  it("RA-07 tampered signature -> 401, next not called, no req.user", () => {
    const t = validToken();
    const segs = t.split(".");
    segs[2] = segs[2].slice(0, -1) + (segs[2].slice(-1) === "a" ? "b" : "a");
    const req: any = { headers: { authorization: `Bearer ${segs.join(".")}` } };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("RA-08 the module touches no database (only requires jsonwebtoken)", () => {
    const src = readFileSync(REQUIRE_AUTH_SRC, "utf8");
    const requires = [...src.matchAll(/require\((['"])(.*?)\1\)/g)].map((m) => m[2]);
    expect(requires).toEqual(["jsonwebtoken"]);
    expect(src).not.toMatch(/require\(.*(models|dal|mongoose)/);
  });

  it("RA-09 valid token missing username -> req.user is { id, username: undefined }", () => {
    const t = jwt.sign({ id: "u1" }, SECRET, { expiresIn: "15m" });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: "u1", username: undefined });
  });
});
