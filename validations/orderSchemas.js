import { z } from "zod";

export const shippingAddressSchema = z.object({
  fullName: z
    .string({ required_error: "Full name is required" })
    .trim()
    .min(2, "Full name must be at least 2 characters"),
  phone: z
    .string({ required_error: "Phone number is required" })
    .trim()
    .min(5, "Invalid phone number"),
  address: z
    .string({ required_error: "Address is required" })
    .trim()
    .min(5, "Address must be at least 5 characters"),
  city: z
    .string({ required_error: "City is required" })
    .trim()
    .min(2, "City must be at least 2 characters"),
  state: z
    .string({ required_error: "State is required" })
    .trim()
    .min(2, "State must be at least 2 characters"),
});

export const createOrderSchema = z.object({
  shippingAddress: shippingAddressSchema,
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(
    ["pending", "paid", "processing", "shipped", "delivered", "cancelled"],
    { message: "Invalid order status" },
  ),
  note: z.string().trim().optional(),
});
