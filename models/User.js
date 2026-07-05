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
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

export default User;
