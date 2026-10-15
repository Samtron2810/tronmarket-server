import mongoose from "mongoose";

// One payout = one admin "mark paid" action settling a seller's eligible
// fulfilments. This is the ledger row behind the payout figures snapshotted
// on each order fulfilment at purchase time.
const payoutSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    orderIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }], default: [] },
    fulfilmentCount: { type: Number, default: 0 },
    method: { type: String, trim: true, maxlength: 60, default: "bank-transfer" },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.models.Payout || mongoose.model("Payout", payoutSchema);
