import mongoose from "mongoose";

// One payout = one admin "mark paid" action. It settles a specific set of
// seller fulfilments (listed in `fulfilments`); each fulfilment is claimed by
// exactly one payout (Order.sellerFulfillments[].payoutId), which is what
// makes payouts idempotent.
const settledFulfilmentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    sellerFulfillment: { type: mongoose.Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const payoutSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    orderIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }], default: [] },
    fulfilments: { type: [settledFulfilmentSchema], default: [] },
    fulfilmentCount: { type: Number, default: 0 },
    method: { type: String, trim: true, maxlength: 60, default: "bank-transfer" },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.models.Payout || mongoose.model("Payout", payoutSchema);
