import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true, maxlength: 120, default: "" },
    // The review text. `comment` is the old field name: rows saved under it
    // are still read (see publicReview) but nothing writes it any more.
    body: { type: String, trim: true, maxlength: 2000, default: "" },
    comment: { type: String, trim: true, maxlength: 2000, default: "" },
    // Set only when the reviewer has a delivered/completed package with the product.
    verifiedPurchase: { type: Boolean, default: false },
    // Set by an admin when hiding a review. A hidden review is not shown, is not
    // counted in the rating, and cannot be edited by its author.
    isHidden: { type: Boolean, default: false },
    moderationReason: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { timestamps: true },
);

reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, createdAt: -1 });

export default mongoose.models.Review || mongoose.model("Review", reviewSchema);
