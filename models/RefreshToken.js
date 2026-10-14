import mongoose from "mongoose";

// One document per issued refresh token (i.e. per signed-in device/session).
// Only a SHA-256 hash of the token is stored — the raw token lives solely
// in the client's httpOnly cookie, so a database leak does not leak usable
// sessions. Tokens rotate on every refresh: the old document is revoked and
// points at its replacement, which lets us detect token-reuse attacks.
const refreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, index: true },
    // Mirrors User.tokenVersion at issuance. A password reset/change bumps
    // tokenVersion, which makes every outstanding refresh token unusable.
    tokenVersion: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RefreshToken",
      default: null,
    },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
  },
  { timestamps: true },
);

// Let MongoDB itself sweep expired sessions.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.RefreshToken ||
  mongoose.model("RefreshToken", refreshTokenSchema);
