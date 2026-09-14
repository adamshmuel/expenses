import { beforeAll, afterAll } from "vitest";
import { startServer, stopServer } from "./server.js";

/**
 * Drop into a test file's top level: starts a fresh `node backend/index.js` for
 * that file (so every file gets fresh in-memory rate limiters) against the test
 * database, and tears it down after. One owner, one lifecycle per file.
 *
 * Kept separate from server.js because server.js is imported by globalSetup,
 * which runs in a context where `vitest` must not be imported.
 */
export function useServer(overrides: Record<string, string> = {}): void {
  beforeAll(async () => {
    await startServer(overrides);
  }, 60_000);
  afterAll(async () => {
    await stopServer();
  }, 20_000);
}
