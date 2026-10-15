import mongoose from "mongoose";

const returnRequestSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    items: {
      type: [
        {
          product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
          name: { type: String, default: "" },
          quantity: { type: Number, default: 1 },
        },
      ],
      default: [],
    },
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

export default mongoose.models.ReturnRequest || mongoose.model("ReturnRequest", returnRequestSchema);
