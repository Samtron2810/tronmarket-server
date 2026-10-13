import { z } from "zod";

const objectId = z
  .string({ error: "A valid id is required" })
  .regex(/^[a-f\d]{24}$/i, { error: "Invalid id" });

// Quantities move money and stock, so they are strict: a whole number of
// at least 1. (A negative or fractional quantity used to sail through
// addToCart and corrupt order totals and inventory.)
const quantity = z
  .number({ error: "Quantity must be a number" })
  .int({ error: "Quantity must be a whole number" })
  .min(1, { error: "Quantity must be at least 1" })
  .max(10000, { error: "Quantity is too large" });

export const addToCartSchema = z.object({
  productId: objectId,
  variantId: objectId.nullable().optional(),
  quantity: quantity.optional().default(1),
});

export const updateCartItemSchema = z.object({
  quantity,
});
