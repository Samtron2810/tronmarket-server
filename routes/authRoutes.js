import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
} from "../controllers/authController.js";
import { loginLimiter, registerLimiter } from "../middlewares/rateLimiter.js";
import { validate } from "../middlewares/validate.js";
import { registerSchema, loginSchema } from "../validations/authSchemas.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// POST /api/auth/register — Zod validates, rate limiter protects
router.post(
  "/register",
  registerLimiter,
  validate(registerSchema),
  registerUser,
);

// POST /api/auth/login — Zod validates, rate limiter protects
router.post("/login", loginLimiter, validate(loginSchema), loginUser);

// POST /api/auth/logout — Protected; uses Redis to blacklist token
router.post("/logout", protect, logoutUser);

export default router;
