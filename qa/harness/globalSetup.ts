import { dropTestDb, closeTestDb } from "./db.js";
import { killPort } from "./server.js";

/**
 * Vitest global setup.
 *
 * The server is NOT started here. Each test file that needs a live server starts
 * its own via `useServer()` in a beforeAll and stops it in afterAll — that gives
 * every file a fresh in-memory rate limiter and a single, unambiguous owner for
 * the server process (Vitest runs test files in separate worker contexts, so a
 * server started in globalSetup cannot be cleanly managed from a test file).
 *
 * Here we only bracket the whole run: free the test port, drop the test DB
 * before (in case a previous run aborted) and after (leave nothing behind).
 */
export async function setup() {
  killPort();
  await dropTestDb();
}

export async function teardown() {
  killPort();
  try {
    await dropTestDb();
  } finally {
    await closeTestDb();
  }
}
