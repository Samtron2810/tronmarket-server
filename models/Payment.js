const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    amount: Number,
    provider: String,
    status: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Payment", paymentSchema);
