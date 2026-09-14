/**
 * Integration tests for backend/index.js start-up sequence
 * Test spec: qa/specs/int-startup.md  (ST-01 .. ST-03)
 * Governing spec: docs/specs/07-server-entry.md §1; 06-server-modules.md §2.
 *
 * The shared server (harness/globalSetup.ts) runs on 3100 against the test DB.
 * globalSetup executes in a separate Vitest context, so we cannot read its
 * in-memory server buffers here — instead we assert against:
 *   - static reads of index.js (statement order)
 *   - backend/logs/app.log, where the running server's Winston logger writes
 *     "Server running on ..." and "connected to MongoDB"
 *   - live HTTP against :3100
 * ST-03 spawns its own broken-URI server and checks it dies.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBackendEnv } from "../../harness/env.js";
import { useServer } from "../../harness/useServer.js";
import { TEST_BASE_URL, BACKEND_LOGS } from "../../harness/paths.js";

useServer();

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const INDEX = resolve(BACKEND, "index.js");
const indexSrc = readFileSync(INDEX, "utf8");
const codeOnly = indexSrc.replace(/\/\*[\s\S]*?\*\//g, "");
const appLog = () => {
  const p = resolve(BACKEND_LOGS, "app.log");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

describe("index.js start-up", () => {
  it("ST-01 dotenv is loaded before anything reads process.env; server boots with PORT", async () => {
    const firstStmt = codeOnly
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("//"));
    expect(firstStmt).toMatch(/require\(["']dotenv["']\)\.config\(\)/);

    const dotenvIdx = Math.max(codeOnly.indexOf('require("dotenv")'), codeOnly.indexOf("require('dotenv')"));
    expect(dotenvIdx).toBeGreaterThanOrEqual(0);
    const afterDotenv = codeOnly.slice(dotenvIdx + 16);
    expect(afterDotenv.search(/require\(/)).toBeGreaterThan(0);

    // The running server logged its readiness line with the TEST port.
    expect(appLog()).toContain("Server running on http://localhost:3100");

    // express.json + the router are mounted: an empty-body login yields a 400.
    const res = await fetch(`${TEST_BASE_URL}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("ST-02 connectDB() is called before app.listen(); server answers after connect", async () => {
    const connectIdx = codeOnly.indexOf("connectDB(");
    const listenIdx = codeOnly.indexOf("app.listen(");
    expect(connectIdx).toBeGreaterThan(0);
    expect(listenIdx).toBeGreaterThan(0);
    expect(connectIdx).toBeLessThan(listenIdx);

    const res = await fetch(`${TEST_BASE_URL}/users/does-not-exist-${Date.now()}`);
    expect(res.headers.get("content-type") || "").toContain("application/json");
    expect(appLog()).toContain("connected to MongoDB");
  });

  it("ST-03 a failed DB connection exits the process instead of staying up", async () => {
    const be = readBackendEnv();
    const child = spawn(process.execPath, [INDEX], {
      cwd: BACKEND,
      env: {
        ...process.env,
        PORT: "3101",
        MONGODB_URI: "mongodb://127.0.0.1:59999/nope?serverSelectionTimeoutMS=3000",
        JWT_SECRET: be.JWT_SECRET,
        REFRESH_TOKEN_SECRET: be.REFRESH_TOKEN_SECRET,
        CLIENT_ORIGIN: be.CLIENT_ORIGIN || "http://localhost:5173",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    const exit = await new Promise<number | null>((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise(null);
      }, 15_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolvePromise(code);
      });
    });

    expect(exit, "server should have exited on a failed DB connection").not.toBeNull();
    expect(exit).not.toBe(0);
    expect(out).toContain("Error connecting to MongoDB");
  }, 25_000);
});
