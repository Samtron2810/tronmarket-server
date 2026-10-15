import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Product from "../models/Product.js";
import Cart from "../models/Cart.js";
import { sendOtpEmail } from "../emails/emailService.js";
import {
  startSession,
  revokeAllSessions,
  revokeSession,
  ACCESS_TOKEN_TTL,
} from "../services/authTokenService.js";
import {
  generateTotpSecret,
  verifyTotp,
  otpauthUrl,
} from "../services/totpService.js";
import { invalidateProductCache, cacheDel } from "../config/redis.js";

function publicUser(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
    sellerVerified: Boolean(user.sellerVerified),
    twoFactorEnabled: Boolean(user.twoFactor?.enabled),
  };
}

async function sessionBody(req, res, user) {
  const accessToken = await startSession(req, res, user);
  return {
    ...publicUser(user),
    token: accessToken,
    accessToken,
    tokenType: "Bearer",
    accessTokenExpiresIn: ACCESS_TOKEN_TTL,
  };
}

// ── Profile ────────────────────────────────────────────────────────────────
export const updateProfile = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (name.length < 2) return res.status(400).json({ message: "Name must be at least 2 characters" });
    const user = await User.findByIdAndUpdate(req.user._id, { name }, { new: true });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update profile" });
  }
};

export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -otp -passwordResetOtp -emailChangeOtp -twoFactor.secret");
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({
      ...publicUser(user),
      savedAddresses: user.savedAddresses || [],
      wishlist: user.wishlist || [],
      createdAt: user.createdAt,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load profile" });
  }
};

// ── Saved addresses ──────────────────────────────────────────────────────────
export const addAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const address = {
      label: req.body.label || "Home",
      fullName: req.body.fullName,
      phone: req.body.phone,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state,
      isDefault: Boolean(req.body.isDefault) || (user.savedAddresses?.length || 0) === 0,
    };
    if (address.isDefault) user.savedAddresses.forEach((a) => (a.isDefault = false));
    user.savedAddresses.push(address);
    await user.save();
    return res.status(201).json({ savedAddresses: user.savedAddresses });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Could not save address" });
  }
};

export const updateAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const address = user.savedAddresses.id(req.params.addressId);
    if (!address) return res.status(404).json({ message: "Address not found" });
    for (const field of ["label", "fullName", "phone", "address", "city", "state"]) {
      if (req.body[field] !== undefined) address[field] = req.body[field];
    }
    if (req.body.isDefault) {
      user.savedAddresses.forEach((a) => (a.isDefault = false));
      address.isDefault = true;
    }
    await user.save();
    return res.json({ savedAddresses: user.savedAddresses });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Could not update address" });
  }
};

export const deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const address = user.savedAddresses.id(req.params.addressId);
    if (!address) return res.status(404).json({ message: "Address not found" });
    const wasDefault = address.isDefault;
    address.deleteOne();
    if (wasDefault && user.savedAddresses[0]) user.savedAddresses[0].isDefault = true;
    await user.save();
    return res.json({ savedAddresses: user.savedAddresses });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete address" });
  }
};

// ── Account self-deletion (soft delete, same rules as admin deletion) ───────
export const deleteMyAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const passwordOk = user.password
      ? await bcrypt.compare(String(req.body?.password || ""), user.password)
      : false;
    if (!passwordOk) return res.status(400).json({ message: "Password is incorrect" });

    const sellerProducts = await Product.find({ seller: user._id }, { _id: 1 }).lean();
    user.name = "Deleted user";
    user.email = `deleted-${user._id}@deleted.local`;
    user.password = `deleted-${Date.now()}`;
    user.pendingEmail = null;
    user.accountStatus = "deleted";
    user.deletedAt = new Date();
    user.deletedBy = user._id;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    await Product.updateMany({ seller: user._id }, { $set: { isActive: false } });
    await invalidateProductCache().catch(() => {});
    await cacheDel(`product:seller:${user._id}`, ...sellerProducts.map((p) => `product:single:${p._id}`)).catch(() => {});
    await Cart.deleteMany({ user: user._id });
    await revokeAllSessions(user._id);
    await revokeSession(req, res);
    return res.json({ success: true, message: "Your account has been deleted." });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete the account" });
  }
};

// ── Two-factor auth (TOTP) ─────────────────────────────────────────────────────
export const twoFactorSetup = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const secret = generateTotpSecret();
    user.twoFactor = { enabled: false, secret };
    await user.save();
    return res.json({
      secret,
      otpauthUrl: otpauthUrl(secret, user.email),
      message: "Add this key to your authenticator app, then verify a code to enable 2FA.",
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not start 2FA setup" });
  }
};

export const twoFactorVerify = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user?.twoFactor?.secret) return res.status(400).json({ message: "Start 2FA setup first" });
    if (!verifyTotp(user.twoFactor.secret, req.body?.code)) {
      return res.status(400).json({ message: "That code is not valid. Try again." });
    }
    user.twoFactor.enabled = true;
    await user.save();
    return res.json({ message: "Two-factor authentication is now on.", twoFactorEnabled: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not enable 2FA" });
  }
};

export const twoFactorDisable = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const passwordOk = await bcrypt.compare(String(req.body?.password || ""), user.password);
    if (!passwordOk) return res.status(400).json({ message: "Password is incorrect" });
    user.twoFactor = { enabled: false, secret: null };
    await user.save();
    return res.json({ message: "Two-factor authentication is off.", twoFactorEnabled: false });
  } catch (error) {
    return res.status(500).json({ message: "Could not disable 2FA" });
  }
};

// Second step of login for accounts with 2FA enabled.
export const twoFactorLogin = async (req, res) => {
  try {
    const { pendingToken, code } = req.body || {};
    const decoded = jwt.verify(String(pendingToken || ""), process.env.JWT_SECRET);
    if (decoded.typ !== "2fa-pending") throw new Error("bad token type");
    const user = await User.findById(decoded.id);
    if (!user || user.accountStatus === "deleted" || !user.twoFactor?.enabled) {
      return res.status(401).json({ message: "This login cannot be completed." });
    }
    if (!verifyTotp(user.twoFactor.secret, code)) {
      return res.status(400).json({ message: "That code is not valid. Try again." });
    }
    return res.json(await sessionBody(req, res, user));
  } catch (error) {
    return res.status(401).json({ message: "Your verification session expired. Please log in again." });
  }
};

export function twoFactorPendingToken(user) {
  return jwt.sign({ id: user._id, typ: "2fa-pending" }, process.env.JWT_SECRET, { expiresIn: "5m" });
}

// ── Google sign-in (env-gated) ─────────────────────────────────────────────────
export const googleAuth = async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ message: "Social login is not configured on this server." });
    }
    const idToken = String(req.body?.idToken || "");
    if (!idToken) return res.status(400).json({ message: "Missing Google credential" });

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!verifyRes.ok) return res.status(401).json({ message: "Google sign-in could not be verified" });
    const payload = await verifyRes.json();
    if (payload.aud !== clientId || payload.email_verified !== "true" || !payload.email) {
      return res.status(401).json({ message: "Google sign-in could not be verified" });
    }

    const email = String(payload.email).toLowerCase();
    let user = await User.findOne({ email });
    if (user?.accountStatus === "deleted") {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    if (!user) {
      user = await User.create({
        name: payload.name || email.split("@")[0],
        email,
        password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
        isVerified: true,
      });
    }
    if (user.twoFactor?.enabled) {
      return res.json({ requiresTwoFactor: true, pendingToken: twoFactorPendingToken(user) });
    }
    return res.json(await sessionBody(req, res, user));
  } catch (error) {
    console.error("googleAuth:", error);
    return res.status(500).json({ message: "Google sign-in failed. Please try again." });
  }
};

// Step-up check used by the profile Security tab: sensitive forms (change
// password/email, 2FA, delete) stay locked until the signed-in user proves
// they still know the current password. Returns no token — it only unlocks
// UI state client-side; every sensitive endpoint still re-verifies on its
// own (change-password and delete both check the password server-side).
export const verifyCurrentPassword = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const ok = user.password
      ? await bcrypt.compare(String(req.body?.password || ""), user.password)
      : false;
    if (!ok) return res.status(400).json({ message: "Password is incorrect" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not verify your password" });
  }
};
