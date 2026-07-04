import rateLimit from "express-rate-limit";

// Strict limiter for login attempts to prevent brute force
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for register to prevent spam
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    message: "Too many registration attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Checkout limiter — prevents rapid order creation
export const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    message: "Too many checkout attempts. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter — baseline DoS protection for all routes
export const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: {
    message: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// FIX #6: Dedicated upload limiter — prevents Cloudinary credit exhaustion
// 20 upload requests per 15 minutes per IP
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    message: "Too many upload requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
