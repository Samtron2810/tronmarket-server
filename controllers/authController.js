import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { blacklistToken } from "../config/redis.js";
import {
  sendOtpEmail,
  sendPasswordResetEmail,
} from "../emails/emailService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

const GENERIC_OTP_MESSAGE =
  "If an account exists for this email, a code has been sent.";
const GENERIC_REGISTER_MESSAGE =
  "If this email can be registered, we have sent a verification code to it.";
const INVALID_CODE_MESSAGE = "Invalid or expired code.";

function generateOtp() {
  // Cryptographically secure — never Math.random() for a credential.
  return String(crypto.randomInt(100000, 1000000));
}

async function hashOtp(otp) {
  return bcrypt.hash(otp, 10);
}

function issueToken(user) {
  return jwt.sign(
    { id: user._id, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}

function publicUser(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
  };
}

function isActive(user) {
  return user && user.accountStatus !== "deleted";
}

function clearRegistrationOtp(user) {
  user.otp = null;
  user.otpExpiresAt = null;
  user.otpAttempts = 0;
}

function clearResetOtp(user) {
  user.passwordResetOtp = null;
  user.passwordResetOtpExpiresAt = null;
  user.passwordResetOtpAttempts = 0;
}

async function setRegistrationOtp(user) {
  const otp = generateOtp();
  user.otp = await hashOtp(otp);
  user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  user.otpAttempts = 0;
  user.otpLastSentAt = new Date();
  await user.save();
  sendOtpEmail(user.email, user.name, otp); // fire-and-forget
}

async function setResetOtp(user) {
  const otp = generateOtp();
  user.passwordResetOtp = await hashOtp(otp);
  user.passwordResetOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  user.passwordResetOtpAttempts = 0;
  user.passwordResetOtpLastSentAt = new Date();
  await user.save();
  sendPasswordResetEmail(user.email, user.name, otp); // fire-and-forget
}

function withinCooldown(lastSentAt) {
  return (
    lastSentAt &&
    Date.now() - new Date(lastSentAt).getTime() < OTP_RESEND_COOLDOWN_MS
  );
}

// ── Register ─────────────────────────────────────────────────────────────────
// The response never reveals whether the email already has an account: a
// new signup, a still-unverified account and a verified account all get
// the same message (only the first two actually receive a code).

export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing && isActive(existing)) {
      if (!existing.isVerified) {
        // Re-sending a code to an unverified account is safe; we do NOT
        // overwrite its name/password from an unauthenticated request.
        if (!withinCooldown(existing.otpLastSentAt)) {
          await setRegistrationOtp(existing);
        }
      }
      return res.status(201).json({
        email,
        isVerified: false,
        requiresVerification: true,
        message: GENERIC_REGISTER_MESSAGE,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      isVerified: false,
    });
    await setRegistrationOtp(user);

    res.status(201).json({
      email: user.email,
      isVerified: false,
      requiresVerification: true,
      message: GENERIC_REGISTER_MESSAGE,
    });
  } catch (error) {
    console.error("registerUser:", error);
    res.status(500).json({ message: "Registration failed. Please try again." });
  }
};

// ── Verify OTP ────────────────────────────────────────────────────────────────

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (
      !isActive(user) ||
      user.isVerified ||
      !user.otp ||
      !user.otpExpiresAt ||
      new Date() > user.otpExpiresAt
    ) {
      if (user && new Date() > (user.otpExpiresAt || 0)) {
        clearRegistrationOtp(user);
        await user.save();
      }
      return res.status(400).json({ message: INVALID_CODE_MESSAGE });
    }

    if ((user.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      clearRegistrationOtp(user);
      await user.save();
      return res.status(429).json({
        message: "Too many incorrect attempts. Please request a new code.",
      });
    }

    const isMatch = await bcrypt.compare(otp, user.otp);
    if (!isMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
        clearRegistrationOtp(user);
        await user.save();
        return res.status(429).json({
          message: "Too many incorrect attempts. Please request a new code.",
        });
      }
      await user.save();
      return res.status(400).json({ message: INVALID_CODE_MESSAGE });
    }

    user.isVerified = true;
    clearRegistrationOtp(user);
    await user.save();

    res.json({ ...publicUser(user), token: issueToken(user) });
  } catch (error) {
    console.error("verifyOtp:", error);
    res.status(500).json({ message: "Verification failed. Please try again." });
  }
};

// ── Resend OTP ────────────────────────────────────────────────────────────────

export const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (isActive(user) && !user.isVerified && !withinCooldown(user.otpLastSentAt)) {
      await setRegistrationOtp(user);
    }

    // Same response whether or not an account exists.
    res.json({ message: GENERIC_OTP_MESSAGE });
  } catch (error) {
    console.error("resendOtp:", error);
    res
      .status(500)
      .json({ message: "Could not resend the code. Please try again." });
  }
};

// ── Forgot / reset password ───────────────────────────────────────────────────
// Requesting a reset always returns the same message. The reset code is a
// separate credential from the registration OTP, has its own attempt cap,
// and a successful reset invalidates every previously issued JWT
// (tokenVersion is bumped).

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (isActive(user) && !withinCooldown(user.passwordResetOtpLastSentAt)) {
      await setResetOtp(user);
    }

    res.json({ message: GENERIC_OTP_MESSAGE });
  } catch (error) {
    console.error("forgotPassword:", error);
    res
      .status(500)
      .json({ message: "Could not process the request. Please try again." });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    const user = await User.findOne({ email });
    if (
      !isActive(user) ||
      !user.passwordResetOtp ||
      !user.passwordResetOtpExpiresAt ||
      new Date() > user.passwordResetOtpExpiresAt
    ) {
      if (user && new Date() > (user.passwordResetOtpExpiresAt || 0)) {
        clearResetOtp(user);
        await user.save();
      }
      return res.status(400).json({ message: INVALID_CODE_MESSAGE });
    }

    if ((user.passwordResetOtpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      clearResetOtp(user);
      await user.save();
      return res.status(429).json({
        message: "Too many incorrect attempts. Please request a new code.",
      });
    }

    const isMatch = await bcrypt.compare(otp, user.passwordResetOtp);
    if (!isMatch) {
      user.passwordResetOtpAttempts =
        (user.passwordResetOtpAttempts || 0) + 1;
      if (user.passwordResetOtpAttempts >= OTP_MAX_ATTEMPTS) {
        clearResetOtp(user);
        await user.save();
        return res.status(429).json({
          message: "Too many incorrect attempts. Please request a new code.",
        });
      }
      await user.save();
      return res.status(400).json({ message: INVALID_CODE_MESSAGE });
    }

    user.password = await bcrypt.hash(password, 10);
    // The code arrived by email, so the address is proven: an unverified
    // account that resets its password becomes verified.
    user.isVerified = true;
    clearRegistrationOtp(user);
    clearResetOtp(user);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.json({
      ...publicUser(user),
      token: issueToken(user),
      message: "Password reset successfully.",
    });
  } catch (error) {
    console.error("resetPassword:", error);
    res
      .status(500)
      .json({ message: "Password reset failed. Please try again." });
  }
};

// ── Change password (logged in) ───────────────────────────────────────────────

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id);
    if (!isActive(user)) {
      return res.status(401).json({ message: "Account no longer exists" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ message: "Current password is incorrect" });
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
    if (sameAsCurrent) {
      return res.status(400).json({
        message: "New password must be different from the current password",
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    clearResetOtp(user);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.json({
      ...publicUser(user),
      // Fresh token for THIS session; every other session is signed out.
      token: issueToken(user),
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("changePassword:", error);
    res
      .status(500)
      .json({ message: "Password change failed. Please try again." });
  }
};

// ── Current user ──────────────────────────────────────────────────────────────

export const getMe = async (req, res) => {
  try {
    if (!isActive(req.user)) {
      return res.status(401).json({ message: "Account no longer exists" });
    }
    res.json(publicUser(req.user));
  } catch (error) {
    console.error("getMe:", error);
    res.status(500).json({ message: "Failed to load account." });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!isActive(user))
      return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials" });

    if (!user.isVerified) {
      return res.status(403).json({
        message: "Please verify your email before logging in.",
        requiresVerification: true,
        email: user.email,
      });
    }

    res.json({ ...publicUser(user), token: issueToken(user) });
  } catch (error) {
    console.error("loginUser:", error);
    res.status(500).json({ message: "Login failed. Please try again." });
  }
};

// ── Logout ────────────────────────────────────────────────────────────────────

export const logoutUser = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      await blacklistToken(token, 7 * 24 * 60 * 60);
    }
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("logoutUser:", error);
    res.status(500).json({ message: "Logout failed. Please try again." });
  }
};
