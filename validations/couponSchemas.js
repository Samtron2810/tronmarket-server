import { z } from "zod";

export const validateCouponSchema = z.object({
  code: z.string().trim().min(2).max(40),
  itemsSubtotal: z.number().nonnegative().optional(),
});

export const createCouponSchema = z.object({
  code: z.string().trim().min(2).max(40),
  type: z.enum(["percent", "fixed"]),
  value: z.number().positive(),
  minSubtotal: z.number().nonnegative().optional(),
  maxUsage: z.number().int().nonnegative().optional(),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const updateCouponSchema = createCouponSchema.partial().omit({ code: true });
