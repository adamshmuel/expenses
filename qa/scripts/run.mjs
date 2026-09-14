#!/usr/bin/env node
/**
 * One-command QA run:
 *   1. run Vitest (it spawns the server against expenses_qa_test via globalSetup,
 *      runs every suite, then stops the server and drops the test DB)
 *   2. build the self-contained HTML report (dated + latest.html)
 *
 * Never edits or commits backend/.env. The test DB is a distinct database name
 * on the same Atlas cluster, dropped on teardown.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const QA = resolve(here, "..");

console.log("── QA run: vitest ───────────────────────────────────────────");
const vitest = spawnSync("npx", ["vitest", "run", "--no-coverage", "--reporter=default", "--reporter=json", "--outputFile=reports/_last-run.json"], {
  cwd: QA,
  stdio: "inherit",
  env: process.env,
});

console.log("\n── QA run: build HTML report ────────────────────────────────");
const report = spawnSync("node", ["scripts/build-report.mjs"], { cwd: QA, stdio: "inherit", env: process.env });

// The QA run's exit code reflects the test outcome; the report always builds.
const code = vitest.status ?? 1;
if (report.status && report.status !== 0) {
  console.error("report builder failed");
}
process.exit(code);
