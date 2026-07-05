import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    message: "Too many registration attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Too many checkout attempts. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { message: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many upload requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP limiter — prevents brute-force and resend spam
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: {
    message: "Too many OTP attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
