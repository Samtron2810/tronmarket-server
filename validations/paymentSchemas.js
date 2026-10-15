import { z } from "zod";

const objectId = z
  .string({ error: "A valid id is required" })
  .regex(/^[a-f\d]{24}$/i, { error: "Invalid id" });

export const initializePaymentSchema = z.object({
  orderId: objectId,
  // Optional return URL for the Paystack hosted checkout. The server only
  // honours it when its origin is on the CORS allowlist.
  callbackUrl: z.string().url().optional(),
});

export const verifyPaymentSchema = z.object({
  reference: z
    .string({ error: "Payment reference is required" })
    .trim()
    .min(1, { error: "Payment reference is required" })
    .max(255, { error: "Payment reference is too long" }),
  // Optional since the server-side payment record already binds a
  // reference to its order; when supplied it must match that binding.
  orderId: objectId.optional(),
});
