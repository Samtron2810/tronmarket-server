import { z } from "zod";

export const createProductSchema = z.object({
  name: z
    .string({ error: "Product name is required" })
    .trim()
    .min(2, { error: "Name must be at least 2 characters" })
    .max(200, { error: "Name is too long" }),
  description: z
    .string({ error: "Description is required" })
    .trim()
    .min(10, { error: "Description must be at least 10 characters" }),
  price: z
    .number({ error: "Price is required" })
    .positive({ error: "Price must be a positive number" })
    .max(999999999, { error: "Price is too high" }),
  category: z
    .string({ error: "Category is required" })
    .trim()
    .min(2, { error: "Category is required" }),
  brand: z.string().trim().optional().default(""),
  stock: z
    .number({ error: "Stock is required" })
    .int({ error: "Stock must be a whole number" })
    .nonnegative({ error: "Stock cannot be negative" })
    .default(0),
  image: z.string().trim().optional().default(""),
  images: z.array(z.string()).optional().default([]),
});

export const updateProductSchema = createProductSchema.partial();
