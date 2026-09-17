import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root (qa/ is one level down). */
export const REPO_ROOT = resolve(here, "..", "..");
export const BACKEND_DIR = resolve(REPO_ROOT, "backend");
export const BACKEND_ENV = resolve(BACKEND_DIR, ".env");
export const BACKEND_INDEX = resolve(BACKEND_DIR, "index.js");
export const BACKEND_LOGS = resolve(BACKEND_DIR, "logs");

/** The test port — deliberately off the dev 3000. */
export const TEST_PORT = 3100;
export const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;

/** The test database name. Never Adam's dev data (which uses Mongoose's default `test` DB). */
export const TEST_DB_NAME = "expenses_qa_test";

/**
 * The lived-in accounts (qa/specs/env-lived-in.md) live in their OWN named
 * database, separate from `expenses_qa_test` above. Two reasons it is not
 * just another database dropped at teardown like the fresh-account one:
 *   1. Adam asked to keep using lv_steady/lv_coffee/lv_sprawl/lv_corrector
 *      himself after a run finishes, so nothing may drop this database at
 *      teardown.
 *   2. It still needs to be deterministic across runs -- so instead it is
 *      rebuilt from the checked-in seed corpus at the START of every run
 *      (qa/env/lived-in.ts's seedLivedIn(), called from globalSetup),
 *      exactly like a fresh migration re-applied, not accumulated onto.
 * Never Adam's real dev data either -- same default-`test`-DB hazard as
 * TEST_DB_NAME above.
 */
export const LIVED_IN_DB_NAME = "expenses_qa_livedin";

/** A second backend+client server pair, dedicated to the lived-in database,
 *  run alongside the fresh-account pair (ports 3100/5174) for the whole e2e
 *  run -- see qa/e2e/playwright.config.ts's two projects. */
export const LIVED_IN_PORT = 3101;
export const LIVED_IN_CLIENT_PORT = 5175;
export const LIVED_IN_BASE_URL = `http://127.0.0.1:${LIVED_IN_PORT}`;
