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
