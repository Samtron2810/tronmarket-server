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
    // Chosen variant (reference kept for restocking on cancel; the label,
    // SKU and price snapshots below are the historical record and survive
    // later variant edits/deactivation).
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductVariant",
    },
    variantLabel: String,
    sku: String,
    name: String,
    image: String,
    price: Number,
    quantity: Number,
  },
  { _id: false },
);

// One fulfilment record per seller in the order. The buyer still places
// (and pays for) a single order, but each seller only ever sees and acts on
// their own items, subtotal and fulfilment status; the order-level status
// is derived from these (see services/orderFulfillmentService.js).
const sellerFulfillmentSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "delivery-claimed",
        "delivered",
        "completed",
        "cancelled",
      ],
      default: "pending",
    },
    // This seller's share of the items subtotal (their items only).
    subtotal: {
      type: Number,
      default: 0,
    },
    // Money split snapshot (see services/pricingService.js): the platform
    // keeps commissionAmount; payoutAmount is what the seller is owed.
    commissionRate: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    payoutAmount: { type: Number, default: 0 },
    payoutStatus: {
      type: String,
      enum: ["not-eligible", "eligible", "paid", "cancelled"],
      default: "not-eligible",
    },
    carrier: { type: String, trim: true, maxlength: 80, default: "" },
    // Lifecycle clocks. deliveredAt drives the "not received" window and
    // auto-complete; completedAt records the final state.
    deliveredAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // The payout that settled this fulfilment (null = not paid out yet).
    // Claimed atomically in payoutController so it can never be paid twice.
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Payout", default: null },
    paidOutAt: { type: Date, default: null },
    // Legacy fulfilment (delivered before the payout ledger) that the operator
    // settles by hand. The ledger never claims it. Set by scripts/markLegacyManual.mjs.
    legacyManual: { type: Boolean, default: false },
    // Goods value (before the order discount) already refunded to the buyer
    // for this seller's items. Commission and payout are computed on the
    // remainder, so a refunded share is never paid out.
    refundedSubtotal: { type: Number, default: 0, min: 0 },
    trackingNumber: { type: String, trim: true, maxlength: 120, default: "" },
    statusHistory: {
      type: [
        {
          status: { type: String },
          note: { type: String },
          changedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
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

    sellerFulfillments: [sellerFulfillmentSchema],

    // What the buyer pays: itemsSubtotal + shippingPrice. totalPrice is
    // kept as the payable grand total for compatibility with payments.
    itemsSubtotal: { type: Number, default: 0 },
    couponCode: { type: String, default: "" },
    discountAmount: { type: Number, default: 0 },
    paymentReminderSentAt: { type: Date, default: null },
    shippingPrice: { type: Number, default: 0 },
    shippingZone: { type: String, default: "" },
    commissionRate: { type: Number, default: 0 },
    commissionTotal: { type: Number, default: 0 },
    sellerPayoutTotal: { type: Number, default: 0 },

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
      landmark: String,
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

    // Unpaid orders only hold their reserved stock until this moment; the
    // expiry sweeper (services/orderExpiryService.js) then cancels the
    // order and returns the stock.
    paymentExpiresAt: Date,

    expiredAt: Date,

    deliveredAt: Date,

    // Refund lifecycle for a paid order (e.g. customer cancels after
    // paying). "none" until a refund is requested; a paid order must not
    // be treated as fully cancelled until this leaves "pending".
    refundStatus: {
      type: String,
      // "partial": some packages/returns were refunded, the rest of the
      // charge is still with the buyer. Per-refund detail lives in Refund.
      enum: ["none", "pending", "partial", "processed", "failed"],
      default: "none",
    },

    refundReference: {
      type: String,
      default: "",
    },

    // Amount refunded (or requested) back to the customer, in Naira.
    refundAmount: {
      type: Number,
      default: 0,
    },

    refundedAt: Date,

    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "completed",
        "delivery-claimed",
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

// Stamp per-seller delivery/completion times on every save so the dispute
// window and auto-complete run on a reliable clock. Legacy fulfilments fall
// back to the order-level deliveredAt (or now).
orderSchema.pre("save", function stampFulfilmentClocks(next) {
  for (const f of this.sellerFulfillments || []) {
    if (["delivered", "completed"].includes(f.status) && !f.deliveredAt) {
      f.deliveredAt = this.deliveredAt || new Date();
    }
    if (f.status === "completed" && !f.completedAt) {
      f.completedAt = new Date();
    }
  }
  next();
});

orderSchema.index({ status: 1, paymentExpiresAt: 1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ status: 1, deliveredAt: -1 });
orderSchema.index({ "sellerFulfillments.seller": 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Order", orderSchema);
