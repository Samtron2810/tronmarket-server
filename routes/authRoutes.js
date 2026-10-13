import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  changePassword,
  getMe,
} from "../controllers/authController.js";
import {
  loginLimiter,
  registerLimiter,
  otpLimiter,
} from "../middlewares/rateLimiter.js";
import { validate } from "../middlewares/validate.js";
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "../validations/authSchemas.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post(
  "/register",
  registerLimiter,
  validate(registerSchema),
  registerUser,
);
router.post("/login", loginLimiter, validate(loginSchema), loginUser);
router.post("/verify-otp", otpLimiter, validate(verifyOtpSchema), verifyOtp);
router.post("/resend-otp", otpLimiter, validate(resendOtpSchema), resendOtp);
router.post(
  "/forgot-password",
  otpLimiter,
  validate(forgotPasswordSchema),
  forgotPassword,
);
router.post(
  "/reset-password",
  otpLimiter,
  validate(resetPasswordSchema),
  resetPassword,
);
router.post(
  "/change-password",
  protect,
  otpLimiter,
  validate(changePasswordSchema),
  changePassword,
);
router.get("/me", protect, getMe);
router.post("/logout", protect, logoutUser);

export default router;
