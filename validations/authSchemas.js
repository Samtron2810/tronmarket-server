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

const emailField = z
  .string({ error: "Email is required" })
  .trim()
  .email({ error: "Invalid email address" })
  .toLowerCase();

const otpField = z
  .string({ error: "Code is required" })
  .length(6, { error: "Code must be exactly 6 digits" })
  .regex(/^\d{6}$/, { error: "Code must contain only digits" });

const newPasswordField = z
  .string({ error: "Password is required" })
  .min(6, { error: "Password must be at least 6 characters" })
  .max(128, { error: "Password is too long" });

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  email: emailField,
  otp: otpField,
  password: newPasswordField,
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: "Current password is required" })
    .min(1, { error: "Current password is required" }),
  newPassword: newPasswordField,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
});

export const savedAddressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  fullName: z.string().trim().min(2, "Full name is required"),
  phone: z.string().trim().min(5, "Phone number is required"),
  address: z.string().trim().min(5, "Address is required"),
  city: z.string().trim().min(2, "City is required"),
  state: z.string().trim().min(2, "State is required"),
  landmark: z.string().trim().max(200).optional(),
  isDefault: z.boolean().optional(),
});

export const twoFactorCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export const twoFactorLoginSchema = z.object({
  pendingToken: z.string().min(10),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(10, "Missing Google credential"),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required"),
});
