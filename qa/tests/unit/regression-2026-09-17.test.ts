/**
 * Unit-level regression cases for 2026-09-17.
 * Test spec: qa/specs/regression-2026-09-17.md
 *
 * RG-17's three shapes are already fully covered by the existing EH-05 block
 * in qa/tests/unit/errorHandling.test.ts EXCEPT `keyValue: {}` (an empty
 * object, as distinct from absent) and the "two keys -> picks the first"
 * case RG-17's method also names -- those two are added here rather than
 * duplicating the whole block.
 *
 * RG-30 is new: backend/ai/parseMessage.js now defines MAX_RESPONSE_BYTES =
 * 8192 and refuses (returns GARBLED_RESPONSE_REPLY, not a throw) a response
 * over that size, retrying once first. The regression spec recorded this as
 * "expected to FAIL -- no such cap exists" on 2026-09-17; re-verified fresh
 * here since the code has since gained one.
 *
 * Also verified as a byproduct of reading parseMessage.js while writing
 * RG-30: bug 3 (RG-01/RG-02/RG-03/RG-04's subject) now has a DETERMINISTIC
 * server-side backstop in addition to the prompt instruction --
 * `textHasNegativeAmount` and `hasSubAgoraPrecision` run on every parse,
 * independent of what the model decided. That is new information relative
 * to the regression spec's framing ("no schema constraint ... it is a model
 * instruction and it is fallible") and is reported as a finding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadCjsWithStubs } from "../../harness/cjs-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const rb = createRequire(resolve(BACKEND, "package.json"));

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = { method: "POST", originalUrl: "/x" };

describe("RG-17 supplement -- error_handling.js duplicate-key fallback, the two shapes EH-05 doesn't try", () => {
  let errorHandler: any;
  const logger = { http: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    Object.values(logger).forEach((f) => f.mockReset());
    const mod = loadCjsWithStubs(BACKEND, "./error_handling.js", { "./.config/logger": logger });
    errorHandler = mod.errorHandler;
  });

  it("keyValue is an empty object (not absent) -> still falls back to 'That value already exists.', no throw", () => {
    const err = Object.assign(new Error("E11000 duplicate key error"), { code: 11000, keyValue: {} });
    const res = makeRes();
    expect(() => errorHandler(err, req, res, vi.fn())).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "That value already exists." });
  });

  it("keyValue has two keys -> names the FIRST one, without throwing", () => {
    const err = Object.assign(new Error("E11000 duplicate key error"), {
      code: 11000,
      keyValue: { username: "a", email: "b" },
    });
    const res = makeRes();
    errorHandler(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "username already exists." });
  });
});

describe("RG-30 -- the AI layer has a response-size ceiling (8192 bytes)", () => {
  const { parseMessage } = rb("./ai/parseMessage.js");

  function fakeClient(text: string) {
    return { models: { generateContent: vi.fn(async () => ({ text })) } };
  }

  it("a response over 8192 UTF-8 bytes is refused with an actionable message, not parsed", async () => {
    // A legitimate-shaped JSON payload padded well past the cap.
    const oversized = JSON.stringify({
      intent: "create-expense",
      drafts: [{ amount: 5, store: "x".repeat(9000), category: "Food" }],
      reply: "ok",
    });
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(8192);

    const client = fakeClient(oversized);
    const result = await parseMessage("spent 5 on something", [], [], { client });

    // Retried once per parseMessage's own comment -- both calls see the same
    // oversized text, so the call count proves the retry happened.
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
    expect(result.intent).toBe("unknown");
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
    // Must not be the raw oversized text bleeding through as the reply.
    expect(result.reply).not.toContain("x".repeat(50));
  });

  it("a response at exactly the cap is not refused for size (boundary: 8192 bytes passes, 8193 does not)", async () => {
    // Build a valid, parseable JSON response and pad it to exactly 8192 bytes
    // using the "reply" field, then one byte over. NOT "store" -- parseMessage's
    // own hasSuspiciousField() refuses any draft.store/description over 200
    // chars regardless of the byte cap (bug 5 guard), which would trip for the
    // wrong reason and confound this specific boundary. "reply" carries no such
    // length check, so padding there isolates the byte-cap logic on its own.
    const build = (padLen: number) =>
      JSON.stringify({ intent: "create-expense", drafts: [{ amount: 5, store: "coffee", category: "Food" }], reply: "ok " + "x".repeat(padLen) });

    let padLen = 0;
    while (Buffer.byteLength(build(padLen), "utf8") < 8192) padLen++;
    // Step back if we overshot on the last increment.
    while (Buffer.byteLength(build(padLen), "utf8") > 8192) padLen--;
    const atCap = build(padLen);
    expect(Buffer.byteLength(atCap, "utf8")).toBe(8192);

    const overCap = build(padLen + 1);
    expect(Buffer.byteLength(overCap, "utf8")).toBe(8193);

    const atCapResult = await parseMessage("spent 5", [], [], { client: fakeClient(atCap) });
    expect(atCapResult.intent).toBe("create-expense"); // not refused for size

    const overCapResult = await parseMessage("spent 5", [], [], { client: fakeClient(overCap) });
    expect(overCapResult.intent).toBe("unknown"); // refused for size
  });
});

describe("Finding: bug 3 (negative amount / precision) has a deterministic server-side backstop, not only a prompt instruction", () => {
  const { parseMessage } = rb("./ai/parseMessage.js");
  function fakeClient(payload: object) {
    return { models: { generateContent: vi.fn(async () => ({ text: JSON.stringify(payload) })) } };
  }

  it("a negative amount in the user's raw text is refused even if the model returns a positive draft", async () => {
    const client = fakeClient({ intent: "create-expense", drafts: [{ amount: 50, store: "coffee", category: "Food" }], reply: "ok" });
    const result = await parseMessage("spent -50 on coffee", [], [], { client });
    expect(result.intent).toBe("unknown");
    expect(result.reply.toLowerCase()).toContain("negative");
  });

  it("an over-precise amount in the model's OWN drafts is refused, regardless of what the prompt asked for", async () => {
    const client = fakeClient({ intent: "create-expense", drafts: [{ amount: 12.345, store: "snacks", category: "Food" }], reply: "ok" });
    const result = await parseMessage("12.345 on snacks", [], [], { client });
    expect(result.intent).toBe("unknown");
    expect(result.reply).toMatch(/two decimal|agora/i);
  });
});
