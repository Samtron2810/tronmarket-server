import mongoose from "mongoose";

// One line of a return: a snapshot of the ordered line (name, variant label,
// price) taken on the server at request time, so later catalogue edits don't
// rewrite history.
const returnItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    variant: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariant", default: null },
    variantLabel: { type: String, trim: true, maxlength: 120, default: "" },
    name: { type: String, trim: true, maxlength: 200, default: "" },
    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const returnRequestSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    details: { type: String, trim: true, maxlength: 2000, default: "" },
    items: { type: [returnItemSchema], default: [] },
    // Sellers whose packages this return touches. Their payouts are held while
    // the return is open, and only theirs (multi-seller orders).
    sellers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    status: {
      type: String,
      enum: ["requested", "approved", "rejected", "refunded"],
      default: "requested",
      index: true,
    },
    adminNote: { type: String, trim: true, maxlength: 1000, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    refundReference: { type: String, default: "" },
  },
  { timestamps: true },
);

returnRequestSchema.index({ order: 1, status: 1 });

export default mongoose.models.ReturnRequest || mongoose.model("ReturnRequest", returnRequestSchema);
