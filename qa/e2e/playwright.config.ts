import { defineConfig, devices } from "@playwright/test";
import { BACKEND_DIR, BACKEND_INDEX, REPO_ROOT } from "../harness/paths.js";
import { readBackendEnv, deriveTestMongoUri } from "../harness/env.js";

/**
 * E2E config: drives the real Vite client against the real backend, both
 * spawned as Playwright `webServer`s on ports distinct from Adam's own dev
 * servers (client 5173, server 3000) so this suite never collides with
 * `npm run dev`. Same test database as the rest of qa/ (see globalSetup.ts).
 */
const E2E_PORT = 3100; // same TEST_PORT the vitest harness uses -- not run concurrently with it
const CLIENT_PORT = 5174;
// Must match exactly what the browser sends as Origin for the CORS check
// (spec 03 §0 requires an exact origin, not "*") -- the client is bound to
// 127.0.0.1, so the Origin header says 127.0.0.1, not "localhost".
const CLIENT_ORIGIN = `http://127.0.0.1:${CLIENT_PORT}`;

const be = readBackendEnv();
const serverEnv = {
  NODE_ENV: "test",
  PORT: String(E2E_PORT),
  MONGODB_URI: deriveTestMongoUri(be.MONGODB_URI),
  JWT_SECRET: be.JWT_SECRET,
  REFRESH_TOKEN_SECRET: be.REFRESH_TOKEN_SECRET,
  CLIENT_ORIGIN,
};

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./globalSetup.ts",
  globalTeardown: "./globalTeardown.ts",
  fullyParallel: false, // one shared server + DB; keep it simple and deterministic
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "../reports/_last-run-e2e.json" }]],
  use: {
    // 127.0.0.1, not "localhost": Vite's dev server (and whatever this
    // machine's resolver hands back for "localhost") only reliably binds/
    // connects over IPv4 here -- "localhost" resolved to the IPv6 loopback
    // and Chromium could not reach it, even though the server was up.
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${process.execPath} ${BACKEND_INDEX}`,
      cwd: BACKEND_DIR,
      env: serverEnv,
      port: E2E_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev --prefix client -- --port ${CLIENT_PORT} --strictPort --host 127.0.0.1`,
      cwd: REPO_ROOT,
      env: { VITE_API_URL: `http://127.0.0.1:${E2E_PORT}` },
      port: CLIENT_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
