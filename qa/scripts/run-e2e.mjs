#!/usr/bin/env node
/**
 * Runs the e2e suite ONE TEST AT A TIME, each as its own `playwright test`
 * invocation -- not the whole suite in one process.
 *
 * Why: found running the full 89-test suite in one go, 2026-09-16.
 * `backend/index.js` mounts a single in-memory `express-rate-limit`
 * (max 300 requests / 15 min / IP) ahead of every route, including signup.
 * Playwright's `webServer` stays up for the WHOLE run by design (one
 * process, matching how a person would actually run the app), so that
 * limiter's counter never resets across tests. By roughly test 25-30 it was
 * already returning 429 on `POST /users/signup` itself -- every test after
 * that failed not because of a real product defect, but because the test
 * before it, and the one before that, had already spent the shared budget.
 * `backend/logs/app.log` from that run has the receipts: dozens of 429s
 * long before the run finished.
 *
 * The vitest harness already solved exactly this for the API/unit suite
 * (qa/harness/useServer.ts's own comment: "gives every file a fresh
 * in-memory rate limiter"), by restarting the server per FILE. A single e2e
 * file here can still carry enough real requests on its own to brush 300
 * (lived-in-flows.spec.ts, with LV-23's 40 real model turns), so this goes
 * one step further and restarts per TEST -- the only granularity that is
 * safe regardless of how any one file grows later.
 *
 * The database setup/teardown is NOT repeated per test -- see
 * globalSetup.ts/globalTeardown.ts's QA_SKIP_DB_SETUP branch. This script
 * does that part itself, exactly once, bracketing the whole run.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Plain `node script.mjs` cannot import qa/harness/*.ts or qa/env/*.ts
 * directly: Node's native TS support strips types but does not resolve a
 * relative `./paths.js` specifier to a sibling `paths.ts` file (that
 * remapping is a bundler/tsc convention, not something vanilla Node does) --
 * confirmed by trying it directly and getting `Cannot find module
 * '.../paths.js'`. vitest and Playwright both paper over this with their
 * own esbuild-based transforms; this script has neither, so it does the
 * same thing directly: bundle the one entry point (and everything it pulls
 * in under qa/) with esbuild, leaving real npm packages (mongoose, ...)
 * external, then import the resulting plain-JS file.
 */
async function bundleTs(entryRelativeToHere) {
  // Written inside qa/, not the OS tmpdir -- so the bundle's `external`
  // package imports (mongoose, ...) still resolve against qa/node_modules
  // at import time. (Found the hard way: os.tmpdir() has no node_modules
  // of its own, so "Cannot find package 'mongoose'" the first time this ran.)
  const cacheDir = resolve(here, "..", ".e2e-bundle-cache");
  mkdirSync(cacheDir, { recursive: true });
  const outfile = resolve(cacheDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await build({
    entryPoints: [resolve(here, entryRelativeToHere)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    packages: "external",
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const { dropTestDb, closeTestDb } = await bundleTs("../harness/db.ts");
const { seedLivedIn, disconnectLivedIn } = await bundleTs("../env/lived-in.ts");
const QA = resolve(here, "..");
const PARTIAL_DIR = resolve(QA, "reports", "_e2e-partial");
const CONFIG = resolve(QA, "e2e", "playwright.config.ts");
const PW_CLI = resolve(QA, "..", "node_modules", "@playwright", "test", "cli.js");

mkdirSync(PARTIAL_DIR, { recursive: true });
// Clear stale partial JSON from a previous run so a missing/failed
// invocation this run can't silently pick up an old file's result.
for (const f of readdirSync(PARTIAL_DIR)) unlinkSync(resolve(PARTIAL_DIR, f));

function listSpecTests() {
  // `--list --reporter=json` gives a structured tree without running anything.
  const res = spawnSync(process.execPath, [PW_CLI, "test", `--config=${CONFIG}`, "--list", "--reporter=json"], {
    cwd: QA,
    encoding: "utf8",
  });
  const json = JSON.parse(res.stdout);
  const out = [];
  // Each top-level suite is one FILE (not one project) -- every test within
  // carries its own `projectName` (confirmed by running `--list
  // --reporter=json` directly and reading the shape; there is no separate
  // project-level wrapper the way the config's two `projects` might suggest).
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        out.push({ file: spec.file, title: spec.title, project: t.projectName });
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const fileSuite of json.suites ?? []) walk(fileSuite);
  return out;
}

function escapeForGrep(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  console.log("── e2e run: one-time database setup (drop fresh, rebuild lived-in) ──");
  await dropTestDb();
  await closeTestDb();
  await seedLivedIn();
  await disconnectLivedIn();

  const tests = listSpecTests();
  console.log(`── e2e run: ${tests.length} tests, one playwright process each ──`);

  const results = []; // { file, title, ok, jsonPath }
  let i = 0;
  for (const t of tests) {
    i++;
    const safeName = `${String(i).padStart(3, "0")}-${t.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}`;
    const jsonPath = resolve(PARTIAL_DIR, `${safeName}.json`);
    console.log(`\n[${i}/${tests.length}] ${t.title}`);
    const args = [
      PW_CLI,
      "test",
      `--config=${CONFIG}`,
      `--project=${t.project}`,
      "-g",
      escapeForGrep(t.title),
      `--reporter=list,json`,
    ];
    const res = spawnSync(process.execPath, args, {
      cwd: QA,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, QA_SKIP_DB_SETUP: "1", PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath },
      timeout: 15 * 60 * 1000, // 15 min ceiling per test -- generous, catches a genuine hang
    });
    results.push({ file: t.file, title: t.title, ok: res.status === 0, jsonPath });
  }

  console.log("\n── e2e run: final database teardown (fresh only -- lived-in is kept) ──");
  await dropTestDb();
  await closeTestDb();

  // ---- merge every partial JSON into one file build-report.mjs can read ----
  const merged = { stats: { duration: 0 }, suites: [] };
  for (const r of results) {
    if (!existsSync(r.jsonPath)) {
      console.error(`missing JSON output for "${r.title}" (${r.jsonPath}) -- treating as a failure`);
      continue;
    }
    const partial = JSON.parse(readFileSync(r.jsonPath, "utf8"));
    merged.stats.duration += partial.stats?.duration ?? 0;
    for (const s of partial.suites ?? []) merged.suites.push(s);
  }
  const outPath = resolve(QA, "reports", "_last-run-e2e.json");
  writeFileSync(outPath, JSON.stringify(merged, null, 2));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\ne2e run complete: ${passed}/${results.length} playwright invocations exited 0.`);
  console.log(`merged JSON written to ${outPath.replace(QA + "/", "qa/")}`);
  process.exit(0); // failures are expected/designed for many of these -- report builder decides what's notable
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
