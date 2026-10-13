import mongoose from "mongoose";

// ─── ProductVariant ──────────────────────────────────────────────────────────
// One document per purchasable variant (a single attribute combination) of a
// Product, e.g. "Galaxy S24 — Black / 256GB". Variants own their SKU, price
// and stock; the parent Product keeps only derived summaries (min price /
// total stock / variantCount) maintained by services/variantService.js.
//
// Variants are deactivated (isActive: false) rather than deleted once they
// may be referenced by carts/orders — order items also snapshot the label,
// SKU and price, so history never depends on this document surviving.
const attributeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const productVariantSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    // Denormalised from Product.seller so seller/admin stock & sales queries
    // can hit this collection directly without joining Product first.
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    sku: {
      type: String,
      trim: true,
      default: "",
    },

    attributes: {
      type: [attributeSchema],
      default: [],
    },

    // Normalised "colour=black|size=m" key built by variantService — powers
    // the unique index below so duplicate combinations are impossible even
    // if application-level validation is bypassed.
    attributeKey: {
      type: String,
      required: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    image: {
      type: String,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// No two variants of the same product may share an attribute combination.
productVariantSchema.index({ product: 1, attributeKey: 1 }, { unique: true });
productVariantSchema.index({ product: 1, isActive: 1 });
productVariantSchema.index({ sku: 1 }, { unique: true, sparse: true });

export default mongoose.model("ProductVariant", productVariantSchema);
