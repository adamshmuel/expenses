/**
 * The one Winston logger for the whole server. Every module that needs to log
 * does `require("./.config/logger")` and calls `logger.http/info/warn/error`.
 *
 * Levels: `http` (one line per request), `info` (server started, DB connected),
 * `warn` (handled 4xx), `error` (5xx and uncaught failures). Minimum level is
 * `http`, so everything above it is recorded too.
 *
 * Destinations:
 *   - Console        — everything, for local development
 *   - logs/app.log   — everything
 *   - logs/error.log — `error` level only (the separate error log)
 *   - logs/ai.log    — only lines tagged `{ area: "ai" }`, the AI-call history
 *
 * Uncaught exceptions and unhandled promise rejections are written to their own
 * files by Winston's exception/rejection handlers, so a crash is never silent.
 *
 * See docs/specs/06-server-modules.md, section 1.
 */

// winston = configurable logger. One logger instance, shared across the app via require.
const winston = require("winston");

// Shared line format: timestamp + [LEVEL]: message + any extra fields as JSON.
// Named so both the logger and the ai.log transport can reuse it without
// repeating the block (a format set on a transport replaces the logger's).
const line = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) =>
        `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ""}`)
);

// Per-transport filter: keep a line only when it carries `area: "ai"`, drop it
// (return false) otherwise. Used to feed logs/ai.log without also sending every
// other log line there.
const onlyAi = winston.format((info) => (info.area === "ai" ? info : false))();


const logger = winston.createLogger({
    // Minimum level to record. "http" also lets through warn/error (they're higher priority).
    level: "http",
    // transports = output destinations. The same log line goes to all of them.
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "./logs/app.log" }),          // everything
        new winston.transports.File({ filename: "./logs/error.log", level: "error" }), // errors only
        new winston.transports.File({
            filename: "./logs/ai.log",
            format: winston.format.combine(onlyAi, line)
        })
    ],
    // Catch crashes that would otherwise kill the process silently, and write them to their own files
    exceptionHandlers: [new winston.transports.File({ filename: "./logs/exception.log" })], // uncaught throw
    rejectionHandlers: [new winston.transports.File({ filename: "./logs/rejection.log" })], // unhandled promise reject
    format: winston.format.combine(line)
})


module.exports = logger;