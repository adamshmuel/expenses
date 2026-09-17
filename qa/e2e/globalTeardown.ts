import { dropTestDb, closeTestDb } from "../harness/db.js";

/**
 * Drops only the fresh-account database (`TEST_DB_NAME`, dropTestDb()'s
 * default). Deliberately does NOT touch `LIVED_IN_DB_NAME` -- Adam keeps
 * using lv_steady/lv_coffee/lv_sprawl/lv_corrector after the run ends; see
 * qa/env/lived-in.ts's file header for how that database stays deterministic
 * anyway (rebuilt at the START of the next run, not dropped at the end of
 * this one). Playwright itself stops the webServers.
 */
export default async function globalTeardown() {
  if (process.env.QA_SKIP_DB_SETUP) return; // see globalSetup.ts's comment
  await dropTestDb();
  await closeTestDb();
}
