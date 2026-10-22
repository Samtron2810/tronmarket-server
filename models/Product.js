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

    // ── Product Ranking & Display System ──────────────────────────
    // isSponsored: a paid promotion (admin-controlled). While sponsored
    // (and not past sponsoredUntil) the product outranks everything else.
    isSponsored: { type: Boolean, default: false },
    sponsoredUntil: { type: Date, default: null },
    // Performance signals, maintained by the hourly ranking job from the
    // Orders/Reviews collections (salesCount is also refreshed there).
    salesCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
    // rankingScore is the single number the storefront sorts by in the
    // "Recommended" (stable) display. It is ONLY recomputed by the hourly
    // background job, never on page load, so the homepage order stays
    // essentially fixed for hours at a time.
    rankingScore: { type: Number, default: 0 },
    rankingUpdatedAt: { type: Date, default: null },

    // Soft visibility switch. Products are deactivated (not deleted) when
    // their seller's account is removed, so historical carts/orders keep
    // working while the listing disappears from the storefront.
    isActive: {
      type: Boolean,
      default: true,
    },

    // Drafts are saved by the seller but never shown on the storefront;
    // pausing is isActive=false. Moderation gates seller-created listings:
    // existing/legacy products count as approved, new seller listings wait
    // for an admin once moderation is in use (see moderationStatus default).
    isDraft: { type: Boolean, default: false },
    // Seller/admin-set sale discount (percent off the list price). Applies
    // to the product price and every variant price; purchasablePrice() is
    // the single place that turns list prices into charged prices.
    discountPercent: { type: Number, default: 0, min: 0, max: 90 },
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
    moderationNote: { type: String, trim: true, maxlength: 500, default: "" },

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

productSchema.index({ seller: 1, createdAt: -1 });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ rankingScore: -1, createdAt: -1 });
productSchema.index({ isSponsored: 1, sponsoredUntil: 1 });
productSchema.index(
  { name: "text", description: "text", brand: "text", category: "text" },
  { weights: { name: 5, brand: 3, category: 2, description: 1 }, name: "product_text_search" },
);
