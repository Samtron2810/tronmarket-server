import mongoose from "mongoose";

// One money movement back to the buyer. Every refund (whole order, one
// seller's package, a return, an upheld report, a mismatched charge) is a row
// here, so partial refunds can be added up against what was charged.
//
// allocations say which goods the refund covers, per seller, at the goods
// value before discount. They are applied to the fulfilments (refundedSubtotal)
// only once the refund is processed, so commission and payout follow the money.
const allocationSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    gross: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const refundSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    paymentReference: { type: String, required: true, index: true },
    scope: { type: String, enum: ["order", "package", "payment"], default: "order" },
    kind: {
      type: String,
      enum: ["order-cancel", "seller-cancel", "return", "dispute", "charge-mismatch", "admin"],
      default: "admin",
    },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    returnRequest: { type: mongoose.Schema.Types.ObjectId, ref: "ReturnRequest", default: null },
    dispute: { type: mongoose.Schema.Types.ObjectId, ref: "Dispute", default: null },
    amount: { type: Number, required: true, min: 0 }, // naira
    allocations: { type: [allocationSchema], default: [] },
    status: { type: String, enum: ["pending", "processed", "failed"], default: "pending", index: true },
    // Paystack refund id (or reference). Webhooks and reconciliation look refunds up by it.
    reference: { type: String, default: "", index: true },
    reason: { type: String, trim: true, maxlength: 300, default: "" },
    failureMessage: { type: String, trim: true, maxlength: 500, default: "" },
    processedAt: { type: Date, default: null },
    // Set once the allocations have been applied to the fulfilments. The
    // claim on this field makes application idempotent (webhook + sweep races).
    adjustedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

refundSchema.index({ order: 1, status: 1 });

export default mongoose.models.Refund || mongoose.model("Refund", refundSchema);
