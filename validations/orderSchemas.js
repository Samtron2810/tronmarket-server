import { z } from "zod";

export const shippingAddressSchema = z.object({
  fullName: z
    .string({ error: "Full name is required" })
    .trim()
    .min(2, { error: "Full name must be at least 2 characters" }),
  phone: z
    .string({ error: "Phone number is required" })
    .trim()
    .min(5, { error: "Invalid phone number" }),
  address: z
    .string({ error: "Address is required" })
    .trim()
    .min(5, { error: "Address must be at least 5 characters" }),
  city: z
    .string({ error: "City is required" })
    .trim()
    .min(2, { error: "City must be at least 2 characters" }),
  state: z
    .string({ error: "State is required" })
    .trim()
    .min(2, { error: "State must be at least 2 characters" }),
});

export const createOrderSchema = z.object({
  shippingAddress: shippingAddressSchema,
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(
    [
      "pending",
      "paid",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
      "completed",
      "delivery-claimed",
    ],
    { error: "Invalid order status" },
  ),
  note: z.string().trim().optional(),
});
