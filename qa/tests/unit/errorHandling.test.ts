/**
 * Unit tests for backend/error_handling.js
 * Test spec: qa/specs/unit-errorHandling.md  (EH-01 .. EH-11)
 * Governing spec: docs/specs/06-server-modules.md §3; 03-api-contract.md §0.
 *
 * error_handling.js require()s './.config/logger'. We seed require.cache with a
 * logger stub (see harness/cjs-stub.ts) so logger.warn / logger.error are spies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCjsWithStubs } from "../../harness/cjs-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");

const logger = { http: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = { method: "POST", originalUrl: "/users/signup" };
const totalLogCalls = () =>
  logger.http.mock.calls.length + logger.info.mock.calls.length + logger.warn.mock.calls.length + logger.error.mock.calls.length;

let catchAsync: any;
let errorHandler: any;

beforeEach(() => {
  Object.values(logger).forEach((f) => f.mockReset());
  const mod = loadCjsWithStubs(BACKEND, "./error_handling.js", {
    "./.config/logger": logger,
  });
  catchAsync = mod.catchAsync;
  errorHandler = mod.errorHandler;
});

describe("error_handling.js — catchAsync", () => {
  it("EH-01 a rejecting handler forwards the error via next(err)", async () => {
    const boom = new Error("kaboom");
    const res = makeRes();
    const next = vi.fn();
    await catchAsync(async () => { throw boom; })(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("EH-02 a resolving handler does not call next", async () => {
    const res = makeRes();
    const next = vi.fn();
    await catchAsync(async (_req: any, r: any) => { r.json({ ok: true }); })(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("EH-03 catchAsync logs nothing", async () => {
    const res = makeRes();
    const next = vi.fn();
    await catchAsync(async () => { throw new Error("x"); })(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(totalLogCalls()).toBe(0);
  });

  it("EH-04 a synchronously-throwing async handler is also caught", async () => {
    const res = makeRes();
    const next = vi.fn();
    await catchAsync(async () => { JSON.parse("{"); })(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(SyntaxError);
  });
});

describe("error_handling.js — errorHandler", () => {
  it("EH-05 err.code 11000 -> 409, {error} shape, logger.warn [wording note]", () => {
    const err = Object.assign(new Error("E11000 duplicate key error ... username_1"), { code: 11000 });
    const res = makeRes();
    errorHandler(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(["error"]);
    expect(typeof body.error).toBe("string");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("EH-06 err.status set -> that status + { error: err.message } + logger.warn", () => {
    const err = Object.assign(new Error("Username or password is incorrect."), { status: 401 });
    const res = makeRes();
    errorHandler(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Username or password is incorrect." });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("EH-07 a 400 with err.status is logged at warn, not error", () => {
    const err = Object.assign(new Error("bad"), { status: 400 });
    const res = makeRes();
    errorHandler(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "bad" });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("EH-08 no status/code -> 500 + generic body + logger.error", () => {
    const err = new Error("connection reset by peer");
    const res = makeRes();
    errorHandler(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Something went wrong." });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("EH-09 the 500 branch never puts err.message in the body", () => {
    const err = new Error("SECRET table users missing column ssn");
    const res = makeRes();
    errorHandler(err, req, res, vi.fn());
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ error: "Something went wrong." });
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(String(logger.error.mock.calls[0][0])).toContain("SECRET");
  });

  it("EH-10 every errorHandler body is exactly { error: <string> }", () => {
    const cases = [
      Object.assign(new Error("dup"), { code: 11000 }),
      Object.assign(new Error("no"), { status: 401 }),
      new Error("boom"),
    ];
    for (const err of cases) {
      const res = makeRes();
      errorHandler(err, req, res, vi.fn());
      const body = res.json.mock.calls[0][0];
      expect(Object.keys(body)).toEqual(["error"]);
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
      expect(body).not.toHaveProperty("errors");
    }
  });

  it("EH-11 errorHandler logs exactly once per call, in every branch", () => {
    for (const err of [
      Object.assign(new Error("dup"), { code: 11000 }),
      Object.assign(new Error("no"), { status: 401 }),
      new Error("boom"),
    ]) {
      Object.values(logger).forEach((f) => f.mockReset());
      errorHandler(err, req, makeRes(), vi.fn());
      expect(totalLogCalls()).toBe(1);
    }
  });
});
