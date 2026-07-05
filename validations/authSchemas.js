import { z } from "zod";

export const registerSchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(2, { error: "Name must be at least 2 characters" })
    .max(50, { error: "Name must be at most 50 characters" }),
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email({ error: "Invalid email address" })
    .toLowerCase(),
  password: z
    .string({ error: "Password is required" })
    .min(6, { error: "Password must be at least 6 characters" })
    .max(128, { error: "Password is too long" }),
});

export const loginSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email({ error: "Invalid email address" })
    .toLowerCase(),
  password: z
    .string({ error: "Password is required" })
    .min(1, { error: "Password is required" }),
});

export const verifyOtpSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email({ error: "Invalid email address" })
    .toLowerCase(),
  otp: z
    .string({ error: "OTP is required" })
    .length(6, { error: "OTP must be exactly 6 digits" })
    .regex(/^\d{6}$/, { error: "OTP must contain only digits" }),
});

export const resendOtpSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email({ error: "Invalid email address" })
    .toLowerCase(),
});
