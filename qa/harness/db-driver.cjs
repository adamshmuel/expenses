/**
 * Tiny driver for the DB-01 / DB-02 / ST-03 child-process tests.
 *
 * It loads backend/.config/db.js and calls connectDB(). connectDB() calls
 * process.exit(1) on failure, so we observe the child's exit code from the test.
 * On success we exit 0 after a short delay.
 *
 * Usage: node qa/harness/db-driver.js
 *   env: MONGODB_URI (required), QA_EXIT_DELAY_MS (optional, default 4000)
 */
const path = require("node:path");

const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");
const { connectDB } = require(path.join(BACKEND_DIR, ".config", "db.js"));

connectDB();

const delay = Number(process.env.QA_EXIT_DELAY_MS || 4000);
setTimeout(() => {
  // If connectDB failed it already exited 1; reaching here means it connected.
  process.exit(0);
}, delay);
