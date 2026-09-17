import { defineConfig, devices } from "@playwright/test";
import { BACKEND_DIR, BACKEND_INDEX, REPO_ROOT, LIVED_IN_DB_NAME, LIVED_IN_PORT, LIVED_IN_CLIENT_PORT } from "../harness/paths.js";
import { readBackendEnv, deriveTestMongoUri } from "../harness/env.js";

/**
 * E2E config: drives the real Vite client against the real backend, both
 * spawned as Playwright `webServer`s on ports distinct from Adam's own dev
 * servers (client 5173, server 3000) so this suite never collides with
 * `npm run dev`.
 *
 * TWO server+client pairs run for the whole suite, each against its own
 * database:
 *   - fresh-account pair (3100/5174) -> `expenses_qa_test`, dropped at
 *     teardown (globalTeardown.ts) -- unchanged from before lived-in existed.
 *   - lived-in pair (3101/5175) -> `LIVED_IN_DB_NAME`, rebuilt from the seed
 *     corpus at the START of every run (globalSetup.ts -> env/lived-in.ts)
 *     and never dropped, so Adam can keep using lv_steady/lv_coffee/
 *     lv_sprawl/lv_corrector after the run ends.
 * The two `projects` below route each spec file at the right pair by name
 * (`lived-in-flows.spec.ts` only) via testMatch/testIgnore, so a lived-in
 * case's `page.goto`/API calls hit the server that actually has that data.
 */
const E2E_PORT = 3100; // same TEST_PORT the vitest harness uses -- not run concurrently with it
const CLIENT_PORT = 5174;
// Must match exactly what the browser sends as Origin for the CORS check
// (spec 03 §0 requires an exact origin, not "*") -- the client is bound to
// 127.0.0.1, so the Origin header says 127.0.0.1, not "localhost".
const CLIENT_ORIGIN = `http://127.0.0.1:${CLIENT_PORT}`;
const LIVED_IN_CLIENT_ORIGIN = `http://127.0.0.1:${LIVED_IN_CLIENT_PORT}`;

const LIVED_IN_SPEC = /lived-in-flows\.spec\.ts$/;

const be = readBackendEnv();
const serverEnv = {
  NODE_ENV: "test",
  PORT: String(E2E_PORT),
  MONGODB_URI: deriveTestMongoUri(be.MONGODB_URI),
  JWT_SECRET: be.JWT_SECRET,
  REFRESH_TOKEN_SECRET: be.REFRESH_TOKEN_SECRET,
  CLIENT_ORIGIN,
};
const livedInServerEnv = {
  NODE_ENV: "test",
  PORT: String(LIVED_IN_PORT),
  MONGODB_URI: deriveTestMongoUri(be.MONGODB_URI, LIVED_IN_DB_NAME),
  JWT_SECRET: be.JWT_SECRET,
  REFRESH_TOKEN_SECRET: be.REFRESH_TOKEN_SECRET,
  CLIENT_ORIGIN: LIVED_IN_CLIENT_ORIGIN,
};

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./globalSetup.ts",
  globalTeardown: "./globalTeardown.ts",
  fullyParallel: false, // shared servers + DBs; keep it simple and deterministic
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
    // Headed so Adam can watch the browser drive the app during a run,
    // rather than just reading the pass/fail report afterward.
    headless: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: LIVED_IN_SPEC },
    {
      name: "chromium-livedin",
      use: { ...devices["Desktop Chrome"], baseURL: LIVED_IN_CLIENT_ORIGIN },
      testMatch: LIVED_IN_SPEC,
    },
  ],
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
    {
      command: `${process.execPath} ${BACKEND_INDEX}`,
      cwd: BACKEND_DIR,
      env: livedInServerEnv,
      port: LIVED_IN_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev --prefix client -- --port ${LIVED_IN_CLIENT_PORT} --strictPort --host 127.0.0.1`,
      cwd: REPO_ROOT,
      env: { VITE_API_URL: `http://127.0.0.1:${LIVED_IN_PORT}` },
      port: LIVED_IN_CLIENT_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
