// Opens the DB connection once at startup. mongoose keeps a single shared connection pool,
// so every model in the app reuses it — no need to pass a connection around.
require("dotenv").config();
const mongoose = require("mongoose");

// Connection string lives in .env (has credentials) so it's not committed in code
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB:", err));

