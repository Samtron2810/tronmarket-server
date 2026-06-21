import { z } from "zod";

export const createProductSchema = z.object({
  name: z
    .string({ required_error: "Product name is required" })
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(200, "Name is too long"),
  description: z
    .string({ required_error: "Description is required" })
    .trim()
    .min(10, "Description must be at least 10 characters"),
  price: z
    .number({ required_error: "Price is required" })
    .positive("Price must be a positive number")
    .max(999999999, "Price is too high"),
  category: z
    .string({ required_error: "Category is required" })
    .trim()
    .min(2, "Category is required"),
  brand: z.string().trim().optional().default(""),
  stock: z
    .number({ required_error: "Stock is required" })
    .int("Stock must be a whole number")
    .nonnegative("Stock cannot be negative")
    .default(0),
  image: z.string().trim().optional().default(""),
  images: z.array(z.string()).optional().default([]),
});

export const updateProductSchema = createProductSchema.partial();
