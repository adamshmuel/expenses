import { readFileSync } from "node:fs";
import { BACKEND_ENV, TEST_DB_NAME } from "./paths.js";

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
