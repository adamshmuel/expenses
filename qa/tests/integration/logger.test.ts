/**
 * Integration tests for backend/.config/logger.js
 * Test spec: qa/specs/int-logger.md  (LG-01 .. LG-07)
 * Governing spec: docs/specs/06-server-modules.md §1; 01-ai-chat.md §9.
 *
 * The logger writes RELATIVE paths (./logs/*.log). We chdir into a temp dir,
 * require a fresh copy of the module, write lines, flush, and read the files.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const requireBackend = createRequire(resolve(BACKEND, "package.json"));

let tmp: string;
let origCwd: string;
let logger: any;

const flush = () => new Promise((r) => setTimeout(r, 400));
const read = (name: string) => {
  const p = join(tmp, "logs", name);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

beforeAll(async () => {
  origCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "qa-logger-"));
  process.chdir(tmp);
  // Bust the require cache so a fresh logger picks up the new cwd for its files.
  const key = requireBackend.resolve("./.config/logger.js");
  delete requireBackend.cache[key];
  logger = requireBackend("./.config/logger.js");

  logger.error("disk fell off", { path: "/x" });
  logger.warn("recovered ok");
  logger.info("gemini call", { area: "ai", ms: 42, ok: true });
  logger.info("server started");
  logger.info("plain message");
  await flush();
});

afterAll(() => {
  process.chdir(origCwd);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
});

describe(".config/logger.js", () => {
  it("LG-01 an error line reaches both error.log and app.log", () => {
    expect(read("error.log")).toContain("disk fell off");
    expect(read("error.log")).toContain("[ERROR]");
    expect(read("app.log")).toContain("disk fell off");
  });

  it("LG-02 a warn line reaches app.log but NOT error.log", () => {
    expect(read("app.log")).toContain("recovered ok");
    expect(read("app.log")).toContain("[WARN]");
    expect(read("error.log")).not.toContain("recovered ok");
  });

  it("LG-03 a line tagged { area: 'ai' } reaches ai.log", () => {
    const ai = read("ai.log");
    expect(ai).toContain("gemini call");
    expect(ai).toContain('"ms":42');
  });

  it("LG-04 a line without area:'ai' does NOT reach ai.log", () => {
    expect(read("ai.log")).not.toContain("server started");
    expect(read("app.log")).toContain("server started");
  });

  it("LG-05 an AI line also appears in app.log", () => {
    expect(read("app.log")).toContain("gemini call");
  });

  it("LG-06 a line with empty meta prints no trailing {}", () => {
    const line = read("app.log")
      .split(/\r?\n/)
      .find((l) => l.includes("plain message"));
    expect(line).toBeTruthy();
    expect(line).not.toContain("{}");
    expect(line).not.toMatch(/\{.*\}/);
  });

  it("LG-07 exception and rejection handlers are configured", () => {
    const excFiles: string[] = [];
    const rejFiles: string[] = [];
    logger.exceptions?.handlers?.forEach((h: any) => {
      const t = h.transport || h;
      if (t?.filename) excFiles.push(t.filename);
      (h.transports || []).forEach((tr: any) => tr.filename && excFiles.push(tr.filename));
    });
    logger.rejections?.handlers?.forEach((h: any) => {
      const t = h.transport || h;
      if (t?.filename) rejFiles.push(t.filename);
      (h.transports || []).forEach((tr: any) => tr.filename && rejFiles.push(tr.filename));
    });
    expect(excFiles.some((f) => f.endsWith("exception.log"))).toBe(true);
    expect(rejFiles.some((f) => f.endsWith("rejection.log"))).toBe(true);
  });
});
