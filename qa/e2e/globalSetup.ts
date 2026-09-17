import { dropTestDb, closeTestDb } from "../harness/db.js";
import { seedLivedIn, disconnectLivedIn } from "../env/lived-in.js";

/**
 * Runs once before the webServers start. Same bracket as the vitest harness's
 * globalSetup: drop the test DB in case a previous run aborted.
 *
 * Deliberately does NOT call killPort() here (unlike the vitest harness).
 * Spawning a synchronous child process (execFileSync("lsof", ...)) from inside
 * Playwright's globalSetup -- before its own webServer machinery starts its
 * child processes -- was reproduced to break network reachability to those
 * webServers for the rest of the run (the browser and even a plain `fetch`
 * get net::ERR_CONNECTION_REFUSED / "fetch failed" against ports the webServer
 * logs clearly show as listening). Harmless when ports are already free
 * (the normal case); if a previous run left one occupied, `reuseExistingServer:
 * false` below throws a clear "already used" error instead of silently
 * corrupting the run -- rerun after freeing the port by hand.
 */
/**
 * QA_SKIP_DB_SETUP: set by qa/scripts/run-e2e.mjs when it drives one spec
 * file per `playwright test` invocation (see that file for why -- the
 * express-rate-limit global limiter is in-memory per server process, and
 * one continuous server for all 89 tests exhausts it partway through,
 * turning later tests' real 429s into false failures). The orchestrator
 * does the DB drop/seed ONCE itself before the whole run and tears down
 * ONCE after; each per-file invocation only needs a fresh SERVER PROCESS
 * (which restarting the webServer already gives it), not a fresh database.
 */
export default async function globalSetup() {
  if (process.env.QA_SKIP_DB_SETUP) return;
  await dropTestDb();
  await closeTestDb();

  // Build the four lived-in accounts (qa/specs/env-lived-in.md) directly via
  // the server's own bl/model layer -- no HTTP call, since the webServers
  // have not started yet (see the file-level comment above). Not a child
  // process, so it does not touch the network-reachability hazard that
  // comment warns about.
  await seedLivedIn();
  await disconnectLivedIn();
}
