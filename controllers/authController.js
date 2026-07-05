import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { blacklistToken } from "../config/redis.js";
import { sendOtpEmail } from "../emails/emailService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function hashOtp(otp) {
  return bcrypt.hash(otp, 10);
}

// ── Register ─────────────────────────────────────────────────────────────────

export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists)
      return res.status(400).json({ message: "Email has already been used" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = generateOtp();
    const hashedOtp = await hashOtp(otp);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      isVerified: false,
      otp: hashedOtp,
      otpExpiresAt,
    });

    sendOtpEmail(email, name, otp); // fire-and-forget

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isVerified: false,
      message:
        "Registration successful. Check your email for the verification code.",
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
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.isVerified)
      return res.status(400).json({ message: "Account is already verified" });

    if (!user.otp || !user.otpExpiresAt)
      return res
        .status(400)
        .json({ message: "No OTP found. Please request a new one." });

    if (new Date() > user.otpExpiresAt)
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });

    const isMatch = await bcrypt.compare(otp, user.otp);
    if (!isMatch) return res.status(400).json({ message: "Invalid OTP" });

    user.isVerified = true;
    user.otp = null;
    user.otpExpiresAt = null;
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: true,
      token,
    });
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
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.isVerified)
      return res.status(400).json({ message: "Account is already verified" });

    const otp = generateOtp();
    const hashedOtp = await hashOtp(otp);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.otp = hashedOtp;
    user.otpExpiresAt = otpExpiresAt;
    await user.save();

    sendOtpEmail(email, user.name, otp); // fire-and-forget

    res.json({
      message: "A new verification code has been sent to your email.",
    });
  } catch (error) {
    console.error("resendOtp:", error);
    res
      .status(500)
      .json({ message: "Could not resend OTP. Please try again." });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

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

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      token,
    });
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
