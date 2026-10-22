import mongoose from "mongoose";

// A buyer's "not received" report about one seller's package in an order.
// While it is open, that seller's payout for the package is held. An admin
// resolves it: "released" lets the seller be paid, "upheld" keeps them unpaid
// and refunds the buyer for that package through the refund engine.
const disputeSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["not-received"], default: "not-received" },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    details: { type: String, trim: true, maxlength: 2000, default: "" },
    status: {
      type: String,
      enum: ["open", "released", "upheld"],
      default: "open",
      index: true,
    },
    adminNote: { type: String, trim: true, maxlength: 1000, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

disputeSchema.index({ order: 1, seller: 1 });

export default mongoose.models.Dispute || mongoose.model("Dispute", disputeSchema);
