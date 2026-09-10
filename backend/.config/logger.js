// winston = configurable logger. One logger instance, shared across the app via require.
const winston = require("winston");


const line = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) =>
        `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ""}`)
);

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
    // How each line is formatted: timestamp + [LEVEL]: message + any extra fields as JSON
    format: winston.format.combine(line)
})


module.exports = logger;