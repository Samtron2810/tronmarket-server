import { z } from "zod";

// FIX #4: Validate role updates through Zod, same as all other routes
export const updateRoleSchema = z.object({
  role: z.enum(["customer", "seller", "admin"], {
    error: "Role must be one of: customer, seller, admin",
  }),
});

// For admin updating any user field
export const updateUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Name must be at least 2 characters" })
    .max(50, { error: "Name must be at most 50 characters" })
    .optional(),
  email: z
    .string()
    .trim()
    .email({ error: "Invalid email address" })
    .toLowerCase()
    .optional(),
  role: z
    .enum(["customer", "seller", "admin"], {
      error: "Role must be one of: customer, seller, admin",
    })
    .optional(),
});
