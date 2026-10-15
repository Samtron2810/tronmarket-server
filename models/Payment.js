import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "NGN",
    },

    provider: {
      type: String,
      default: "paystack",
    },

    reference: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "success",
        "failed",
        // A real charge that cannot be applied to its order (wrong amount,
        // late payment for a cancelled order, second payment, ...). The
        // money exists at Paystack but must never mark an order paid.
        "requires_refund",
        "refund_pending",
        "refunded",
        "refund_failed",
      ],
      default: "pending",
    },

    // Paystack refund identifier once a refund has been requested.
    refundReference: {
      type: String,
      default: "",
    },

    paidAt: Date,
  },
  { timestamps: true },
);

export default mongoose.model("Payment", paymentSchema);
