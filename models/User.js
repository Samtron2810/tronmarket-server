import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: "customer",
    },

    // ── Email verification ───────────────────────────────────────────────────
    isVerified: { type: Boolean, default: false },
    otp: { type: String, default: null }, // hashed 6-digit code
    otpExpiresAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    otpLastSentAt: { type: Date, default: null },

    // ── Password recovery ────────────────────────────────────────────────────
    // Kept separate from the registration OTP so a reset code can never be
    // used to verify an account (or vice versa).
    passwordResetOtp: { type: String, default: null }, // hashed 6-digit code
    passwordResetOtpExpiresAt: { type: Date, default: null },
    passwordResetOtpAttempts: { type: Number, default: 0 },
    passwordResetOtpLastSentAt: { type: Date, default: null },

    // Bumped whenever credentials change so previously issued JWTs stop
    // working (the value travels in the token as `tv`).
    tokenVersion: { type: Number, default: 0 },

    // ── Soft deletion ────────────────────────────────────────────────────────
    // Accounts are anonymised, never hard-deleted: orders, payments and
    // seller history keep a valid (but PII-free) user reference.
    accountStatus: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
    },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

export default User;
