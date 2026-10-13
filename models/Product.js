import mongoose from "mongoose";

// Option definitions only, e.g. { name: "Size", values: ["S", "M", "L"] }.
// The purchasable combinations live in the ProductVariant collection.
const optionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    values: { type: [String], default: [] },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },

    category: {
      type: String,
      required: true,
    },

    brand: {
      type: String,
      default: "",
    },

    stock: {
      type: Number,
      default: 0,
    },

    image: {
      type: String,
      default: "",
    },

    images: {
      type: [String],
      default: [],
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    rating: {
      type: Number,
      default: 0,
    },

    numReviews: {
      type: Number,
      default: 0,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    // ── Variants (see models/ProductVariant.js) ──────────────────────────
    // When hasVariants is true, `price`/`stock` above are DERIVED summaries
    // (min active-variant price / sum of active-variant stock) maintained by
    // services/variantService.syncProductSummary — never set them from
    // variant payloads directly. When false they are the real values, as
    // before (all pre-variant products keep working unchanged).
    hasVariants: {
      type: Boolean,
      default: false,
    },

    options: {
      type: [optionSchema],
      default: [],
    },

    variantCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Populated on product detail (GET /products/:id). List endpoints do not
// populate this — they use the summary fields above instead.
productSchema.virtual("variants", {
  ref: "ProductVariant",
  localField: "_id",
  foreignField: "product",
});

export default mongoose.model("Product", productSchema);
