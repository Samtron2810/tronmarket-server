import mongoose from "mongoose";

// One message in the buyer <-> seller thread for an order. There is one
// thread per (order, seller): a multi-seller order has a separate conversation
// with each seller, so a buyer never sees another seller's packages in it.
const orderMessageSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderRole: { type: String, enum: ["buyer", "seller", "admin"], required: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
  },
  { timestamps: true },
);

orderMessageSchema.index({ order: 1, seller: 1, createdAt: 1 });

export default mongoose.models.OrderMessage || mongoose.model("OrderMessage", orderMessageSchema);
