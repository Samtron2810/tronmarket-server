import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  verifyOtp,
  resendOtp,
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
router.post("/logout", protect, logoutUser);

export default router;
