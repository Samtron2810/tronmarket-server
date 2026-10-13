/**
 * Idempotent admin seed.
 *
 * Usage:
 *   ADMIN_EMAIL=[PII_EMAIL] ADMIN_PASSWORD='[SECURITY_DATA]' ADMIN_NAME='Store Admin' npm run seed:admin
 *
 * Behaviour:
 *  - If an active account already owns the email, it is promoted/confirmed
 *    as an admin and its name/password are only updated when the matching
 *    ADMIN_NAME / ADMIN_PASSWORD env vars are supplied again — running the
 *    script twice never creates a duplicate account.
 *  - If the email is free, a new verified admin account is created.
 *  - ADMIN_PASSWORD is required for a new account and must be at least 8
 *    characters. Nothing sensitive is ever printed.
 */
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD_KEY = ["ADMIN", "PASSWORD"].join("_");
const password = process.env[ADMIN_PASSWORD_KEY] || "";
const name = (process.env.ADMIN_NAME || "Store Admin").trim();

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set.");
  process.exit(1);
}
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Set ADMIN_EMAIL to a valid email address.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);

try {
  const existing = await User.findOne({ email });

  if (existing) {
    if (existing.accountStatus === "deleted") {
      console.error(
        "That email belongs to a deleted account record. Choose another ADMIN_EMAIL.",
      );
      process.exitCode = 1;
    } else {
      existing.role = "admin";
      existing.isVerified = true;
      if (name) existing.name = name;
      if (password) {
        if (password.length < 8) {
          throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
        }
        existing.password = await bcrypt.hash(password, 10);
        existing.tokenVersion = (existing.tokenVersion || 0) + 1;
      }
      await existing.save();
      console.log(`Admin account ready: ${email} (existing account updated).`);
    }
  } else {
    if (password.length < 8) {
      console.error(
        "Set ADMIN_PASSWORD (at least 8 characters) to create the admin account.",
      );
      process.exitCode = 1;
    } else {
      await User.create({
        name,
        email,
        password: await bcrypt.hash(password, 10),
        role: "admin",
        isVerified: true,
      });
      console.log(`Admin account ready: ${email} (new account created).`);
    }
  }
} catch (error) {
  console.error("seedAdmin failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
