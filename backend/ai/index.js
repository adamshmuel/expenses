/**
 * The only entry point into backend/ai/ — everything outside this folder
 * imports from here, never from the individual files directly.
 */

const { parseMessage } = require("./parseMessage");

module.exports = { parseMessage };
