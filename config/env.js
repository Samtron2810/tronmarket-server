// Loads .env into process.env. Import this FIRST in server.js: ES module imports
// run before any statement in the importing file, and several modules read
// process.env at import time (order windows, reconciliation timings). If
// dotenv ran in server.js's body, those values would ignore the .env file.
import dotenv from "dotenv";

dotenv.config();
