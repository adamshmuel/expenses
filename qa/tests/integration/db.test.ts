/**
 * Integration tests for backend/.config/db.js — connectDB()
 * Test spec: qa/specs/int-db.md  (DB-01 .. DB-03)
 * Governing spec: docs/specs/06-server-modules.md §2, §6 decision 3.
 *
 * connectDB() calls process.exit() on failure, so DB-01/DB-02 run it in a child
 * process via qa/harness/db-driver.js.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBackendEnv, deriveTestMongoUri } from "../../harness/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const DRIVER = resolve(here, "..", "..", "harness", "db-driver.cjs");

function runDriver(mongoUri: string, exitDelayMs = 4000, timeoutMs = 25_000) {
  return new Promise<{ code: number | null; out: string }>((resolvePromise) => {
    const child = spawn(process.execPath, [DRIVER], {
      cwd: BACKEND,
      env: { ...process.env, MONGODB_URI: mongoUri, QA_EXIT_DELAY_MS: String(exitDelayMs) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, out });
    });
  });
}

describe(".config/db.js — connectDB()", () => {
  it("DB-01 a good URI connects and logs one info line, exits 0", async () => {
    const be = readBackendEnv();
    const uri = deriveTestMongoUri(be.MONGODB_URI);
    const { code, out } = await runDriver(uri, 4000);
    expect(code).toBe(0);
    expect(out).toContain("connected to MongoDB");
    expect(out).toContain("[INFO]");
    expect(out).not.toContain("[ERROR]");
  }, 30_000);

  it("DB-02 a bad URI logs an error line and exits non-zero", async () => {
    const { code, out } = await runDriver("mongodb://127.0.0.1:59999/nope?serverSelectionTimeoutMS=3000", 15000);
    expect(code).not.toBe(0);
    expect(out).toContain("Error connecting to MongoDB");
    expect(out).toContain("[ERROR]");
  }, 30_000);

  it("DB-03 db.js exports only { connectDB } and registers no models", () => {
    const rb = createRequire(resolve(BACKEND, "package.json"));
    const mongoose = rb("mongoose");
    const before = [...mongoose.modelNames()];
    const key = rb.resolve("./.config/db.js");
    delete rb.cache[key];
    const mod = rb("./.config/db.js");
    expect(Object.keys(mod).sort()).toEqual(["connectDB"]);
    expect(typeof mod.connectDB).toBe("function");
    expect(mongoose.modelNames()).toEqual(before);
  });
});
