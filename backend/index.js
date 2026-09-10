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


app.use(compression());
app.use(helmet());
app.use(cors({
    origin: process.env.CLIENT_ORIGIN,
    credentials: true
}));               
app.use(express.json());
app.use(cookieParser());
app.use(morgan("combined", {
    stream: {
        write: (message) => logger.http(message)
    }
}));
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: "Too many requests, please slow down." },
});
app.use(globalLimiter);
app.use("/users", userRouter);
app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
});
app.use(errorHandler);
connectDB();
app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
});

