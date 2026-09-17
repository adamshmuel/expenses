import { readFileSync } from "node:fs";
import { BACKEND_ENV, BACKEND_DIR, TEST_DB_NAME } from "./paths.js";
import { resolve } from "node:path";

/**
 * Parse backend/.env WITHOUT importing it into this process's env, and without
 * ever writing or committing it. We only read the values we need to spawn the
 * server against a test database.
 */
export function readBackendEnv(): Record<string, string> {
  const raw = readFileSync(BACKEND_ENV, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

/**
 * Read the refresh-rotation race/replay grace window straight out of
 * backend/bl/userService.js's source text, WITHOUT importing the module (we
 * never import backend/ code into the QA process). Tests that need to wait
 * past the window call this instead of hardcoding a duration, so they keep
 * working if Adam tunes `RACE_GRACE_MS` (e.g. 10s -> 3s).
 */
export function readRaceGraceMs(): number {
  const src = readFileSync(resolve(BACKEND_DIR, "bl", "userService.js"), "utf8");
  const m = src.match(/RACE_GRACE_MS\s*=\s*([\d_]+)\s*\*\s*([\d_]+)/);
  if (!m) {
    throw new Error("Could not find RACE_GRACE_MS in backend/bl/userService.js — did its definition change shape?");
  }
  return Number(m[1].replace(/_/g, "")) * Number(m[2].replace(/_/g, ""));
}

/**
 * Rewrite a MongoDB connection string so it targets an explicit test database
 * name. Adam's URI has no path segment, so the running dev server uses Mongoose's
 * default `test` DB; appending `/expenses_qa_test` keeps our writes fully
 * separate from anything he has.
 */
export function deriveTestMongoUri(baseUri: string, dbName = TEST_DB_NAME): string {
  // mongodb+srv://user:pass@host[/db][?query]
  return baseUri.replace(
    /^(mongodb(?:\+srv)?:\/\/[^/]+)(\/[^?]*)?(\?.*)?$/,
    (_full, hostpart: string, _db: string | undefined, query: string | undefined) =>
      `${hostpart}/${dbName}${query ?? ""}`
  );
}
