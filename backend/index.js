/**
 * Server entry point. Loads the environment, builds the Express app, mounts the
 * middleware and routers in order, connects to MongoDB, and starts listening.
 *
 * No business logic lives here — every piece is defined elsewhere (the modules
 * in .config/ and error_handling.js, the router in routes/). This file only
 * decides what is mounted and in what order.
 *
 * See docs/specs/07-server-entry.md.
 */

// dotenv first, before any require that reads process.env.
require("dotenv").config();
const express = require('express');
const app = express()
const { connectDB } = require("./.config/db");
const compression = require('compression');
const morgan = require("morgan");
const helmet = require("helmet");
const cors = require('cors');
const cookieParser = require("cookie-parser");
const logger = require("./.config/logger");
const rateLimit = require('express-rate-limit');
const { errorHandler } = require("./error_handling");
const userRouter = require('./routes/userRoute');
const port = process.env.PORT || 3000;


// --- Middleware, in order (spec 07 §2) ---
app.use(compression());               // gzip response bodies
app.use(helmet());                    // safe HTTP headers — first, so it covers every response
app.use(cors({                        // exact client origin + credentials, because the client sends the refresh cookie
    origin: process.env.CLIENT_ORIGIN,
    credentials: true
}));
app.use(express.json());              // parse JSON bodies into req.body
app.use(cookieParser());              // populate req.cookies, read by /users/refresh and /users/logout
app.use(morgan("combined", {          // one line per request, piped into Winston at http level
    stream: {
        write: (message) => logger.http(message)
    }
}));

// Loose blanket limiter. The strict login limiter is separate, in userRoute.js.
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: "Too many requests, please slow down." },
});
app.use(globalLimiter);

// --- Routers (no /api prefix) ---
app.use("/users", userRouter);

// --- Tail: 404, then the central error handler, registered last (spec 07 §4) ---
app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
});
app.use(errorHandler);

// --- Start up: connect (exits the process on failure), then listen ---
connectDB();
app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
});

