import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    name: String,
    image: String,
    price: Number,
    quantity: Number,
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    orderItems: [orderItemSchema],

    totalPrice: {
      type: Number,
      required: true,
      default: 0,
    },

    shippingAddress: {
      fullName: String,
      phone: String,
      address: String,
      city: String,
      state: String,
    },

    paymentMethod: {
      type: String,
      default: "paystack",
    },

    paymentReference: {
      type: String,
    },

    isPaid: {
      type: Boolean,
      default: false,
    },

    paidAt: Date,

    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },

    statusHistory: {
      type: [
        {
          status: { type: String },
          note: { type: String },
          changedAt: { type: Date, default: Date.now },
        },
      ],
      default: [{ status: "pending", note: "Order placed" }],
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Order", orderSchema);
