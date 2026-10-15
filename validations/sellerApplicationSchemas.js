import { z } from "zod";

export const createSellerApplicationSchema = z.object({
  storeName: z
    .string({ error: "Store name is required" })
    .trim()
    .min(2, { error: "Store name must be at least 2 characters" })
    .max(100, { error: "Store name is too long" }),
  businessDescription: z
    .string({ error: "Business description is required" })
    .trim()
    .min(20, {
      error: "Please describe your business in at least 20 characters",
    })
    .max(2000, { error: "Business description is too long" }),
  contactPhone: z
    .string({ error: "Contact phone is required" })
    .trim()
    .min(7, { error: "Please enter a valid phone number" })
    .max(30, { error: "Phone number is too long" }),
});

export const reviewSellerApplicationSchema = z.object({
  status: z.enum(["approved", "rejected"], {
    error: "Status must be 'approved' or 'rejected'",
  }),
  reviewNote: z
    .string()
    .trim()
    .max(1000, { error: "Review note is too long" })
    .optional()
    .default(""),
});
