import { z } from "zod";

// ── Variants ────────────────────────────────────────────────────────────────
// A product option: { name: "Size", values: ["S", "M", "L"] }
// A variant input: one purchasable combination of option values.
export const MAX_VARIANT_OPTIONS = 3;
export const MAX_VARIANTS = 100;

export const optionSchema = z.object({
  name: z
    .string({ error: "Option name is required" })
    .trim()
    .min(1, { error: "Option name is required" })
    .max(40, { error: "Option name is too long" }),
  values: z
    .array(
      z
        .string()
        .trim()
        .min(1, { error: "Option values cannot be empty" })
        .max(60, { error: "Option value is too long" }),
    )
    .min(1, { error: "Each option needs at least one value" })
    .max(30, { error: "Too many values for one option" }),
});

export const variantAttributeSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string().trim().min(1),
});

// Product imagery is a URL (uploaded to Cloudinary first) — never an
// arbitrary string or an inline data blob, and never an unbounded list.
export const imageUrlSchema = z
  .string({ error: "Image must be a URL" })
  .trim()
  .max(2048, { error: "Image URL is too long" })
  .refine((value) => value === "" || /^https?:\/\//i.test(value), {
    error: "Image must be an http(s) URL",
  });

export const variantInputSchema = z.object({
  _id: z.string().trim().optional(),
  sku: z.string().trim().max(80).optional().default(""),
  attributes: z
    .array(variantAttributeSchema)
    .min(1, { error: "Each variant needs at least one attribute" })
    .max(MAX_VARIANT_OPTIONS, { error: "Too many attributes on one variant" }),
  price: z
    .number({ error: "Variant price is required" })
    .nonnegative({ error: "Variant price cannot be negative" })
    .max(999999999, { error: "Variant price is too high" })
    .optional(),
  stock: z
    .number()
    .int({ error: "Variant stock must be a whole number" })
    .nonnegative({ error: "Variant stock cannot be negative" })
    .default(0),
  image: imageUrlSchema.optional().default(""),
  isActive: z.boolean().optional().default(true),
});

function attributeKey(attributes) {
  return attributes
    .map((a) => `${a.name.trim().toLowerCase()}=${a.value.trim().toLowerCase()}`)
    .sort()
    .join("|");
}

// Shared refinement: when hasVariants is on, options/variants must be
// present, consistent (variant values drawn from declared options), and
// free of duplicate combinations. Runs fully on create; on update it only
// validates the variant block when the payload actually carries one.
function refineVariants(data, ctx, { partial = false } = {}) {
  const hasVariants = data.hasVariants;
  if (hasVariants === undefined && partial) {
    // Variant fields not being touched by this update.
    if (data.variants === undefined && data.options === undefined) return;
  }
  if (!hasVariants) return;

  const options = data.options ?? [];
  const variants = data.variants ?? [];

  if (options.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: "Add at least one option (e.g. Size) for a variant product",
    });
  }
  if (options.length > MAX_VARIANT_OPTIONS) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: `At most ${MAX_VARIANT_OPTIONS} options per product`,
    });
  }
  if (variants.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["variants"],
      message: "Add at least one variant for a variant product",
    });
  }
  if (variants.length > MAX_VARIANTS) {
    ctx.addIssue({
      code: "custom",
      path: ["variants"],
      message: `At most ${MAX_VARIANTS} variants per product`,
    });
  }

  // Unique option names + unique values within an option
  const optionNames = new Set();
  for (const opt of options) {
    const key = opt.name.trim().toLowerCase();
    if (optionNames.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `Duplicate option: ${opt.name}`,
      });
    }
    optionNames.add(key);
    const values = opt.values.map((v) => v.trim().toLowerCase());
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `Duplicate value in option: ${opt.name}`,
      });
    }
  }

  // Variant combinations: complete, drawn from options, unique
  const declared = new Map(
    options.map((o) => [
      o.name.trim().toLowerCase(),
      new Set(o.values.map((v) => v.trim().toLowerCase())),
    ]),
  );
  const seen = new Set();
  for (const variant of variants) {
    for (const attr of variant.attributes) {
      const allowed = declared.get(attr.name.trim().toLowerCase());
      if (!allowed) {
        ctx.addIssue({
          code: "custom",
          path: ["variants"],
          message: `Variant uses undeclared option: ${attr.name}`,
        });
      } else if (!allowed.has(attr.value.trim().toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: ["variants"],
          message: `"${attr.value}" is not a value of option "${attr.name}"`,
        });
      }
    }
    if (options.length > 0 && variant.attributes.length !== options.length) {
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Each variant must pick a value for every option",
      });
    }
    const key = attributeKey(variant.attributes);
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message: `Duplicate variant combination: ${variant.attributes.map((a) => a.value).join(" / ")}`,
      });
    }
    seen.add(key);
  }
}

const productObject = z.object({
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
    .nonnegative({ error: "Price must be zero or a positive number" })
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
  image: imageUrlSchema.optional().default(""),
  images: z
    .array(imageUrlSchema)
    .max(10, { error: "At most 10 images per product" })
    .optional()
    .default([]),
  isFeatured: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  isActive: z.boolean().optional(),
  hasVariants: z.boolean().optional().default(false),
  options: z.array(optionSchema).optional().default([]),
  variants: z.array(variantInputSchema).optional().default([]),
});

export const createProductSchema = productObject.superRefine((data, ctx) =>
  refineVariants(data, ctx),
);

export const updateProductSchema = productObject
  .partial()
  .superRefine((data, ctx) => refineVariants(data, ctx, { partial: true }));
