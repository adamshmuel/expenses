/**
 * Opens the MongoDB connection once, at start-up. Mongoose keeps a single shared
 * connection pool, so every model in the app reuses it — nothing passes a
 * connection around.
 *
 * See docs/specs/06-server-modules.md, section 2.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const logger = require("./logger");

/**
 * Connect to MongoDB using `MONGODB_URI` from the environment. `index.js` calls
 * this once during start-up.
 *
 * On success: logs one `info` line. On failure: logs the error and exits the
 * process with code 1 — a server with no database can only answer every route
 * with a 500, so it should not stay up.
 *
 * The connection string lives in `.env` (it has credentials) and is never
 * committed.
 *
 * @returns {void}
 */
function connectDB() {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => logger.info("connected to MongoDB"))
    .catch((err) => {
      logger.error("Error connecting to MongoDB", { stack: err.stack });
      process.exit(1);
    });

}

module.exports = {
  connectDB
}