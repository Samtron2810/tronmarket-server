import mongoose from "mongoose";

const savedAddressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 40, default: "Home" },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    landmark: { type: String, trim: true, maxlength: 200, default: "" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

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

    // ── Email change (re-verification required) ─────────────────────────────
    pendingEmail: { type: String, default: null },
    emailChangeOtp: { type: String, default: null }, // hashed 6-digit code
    emailChangeOtpExpiresAt: { type: Date, default: null },
    emailChangeOtpAttempts: { type: Number, default: 0 },

    // ── Profile extras ───────────────────────────────────────────────────────
    savedAddresses: { type: [savedAddressSchema], default: [] },
    wishlist: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    // Set when an admin approves the seller application — shown as a
    // "Verified Seller" badge on the storefront.
    sellerVerified: { type: Boolean, default: false },

    // ── Two-factor auth (TOTP; required-optional for admins) ────────────────
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, default: null }, // base32 TOTP secret
    },

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
