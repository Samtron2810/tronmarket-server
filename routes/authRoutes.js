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
  refreshSession,
} from "../controllers/authController.js";
import {
  updateProfile,
  getMyProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  deleteMyAccount,
  twoFactorSetup,
  twoFactorVerify,
  twoFactorDisable,
  twoFactorLogin,
  googleAuth,
  verifyCurrentPassword,
} from "../controllers/accountController.js";
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
  updateProfileSchema,
  savedAddressSchema,
  twoFactorCodeSchema,
  twoFactorDisableSchema,
  twoFactorLoginSchema,
  googleAuthSchema,
  deleteAccountSchema,
} from "../validations/authSchemas.js";
import { protect } from "../middlewares/authMiddleware.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";
import { z } from "zod";

const router = express.Router();

router.post(
  "/register",
  registerLimiter,
  validate(registerSchema),
  registerUser,
);
router.post("/login", loginLimiter, validate(loginSchema), loginUser);
router.post("/2fa/login", loginLimiter, validate(twoFactorLoginSchema), twoFactorLogin);
router.post("/google", loginLimiter, validate(googleAuthSchema), googleAuth);
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

// Account management
router.post(
  "/verify-password",
  protect,
  loginLimiter,
  validate(z.object({ password: z.string().min(1) }).strict()),
  verifyCurrentPassword,
);
router.get("/profile", protect, getMyProfile);
router.put("/profile", protect, validate(updateProfileSchema), updateProfile);
router.post("/addresses", protect, validate(savedAddressSchema), addAddress);
router.put(
  "/addresses/:addressId",
  protect,
  validateObjectIdParams("addressId"),
  validate(savedAddressSchema.partial()),
  updateAddress,
);
router.delete(
  "/addresses/:addressId",
  protect,
  validateObjectIdParams("addressId"),
  deleteAddress,
);
router.delete("/me", protect, validate(deleteAccountSchema), deleteMyAccount);

// Two-factor authentication
router.post("/2fa/setup", protect, twoFactorSetup);
router.post("/2fa/verify", protect, validate(twoFactorCodeSchema), twoFactorVerify);
router.post("/2fa/disable", protect, validate(twoFactorDisableSchema), twoFactorDisable);

// Refresh exchanges the httpOnly refresh cookie for a new access token.
// Logout intentionally has no `protect`: it must work even when the
// access token has already expired.
router.post("/refresh", refreshSession);
router.post("/logout", logoutUser);

export default router;
