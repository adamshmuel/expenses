import { dropTestDb, closeTestDb } from "../harness/db.js";

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
export default async function globalSetup() {
  await dropTestDb();
  await closeTestDb();
}
