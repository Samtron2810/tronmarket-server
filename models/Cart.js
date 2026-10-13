import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // The chosen ProductVariant document (null for legacy no-variant
    // products). A cart line is uniquely product + variant: the same
    // product in Black/M and White/L is two lines.
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductVariant",
      default: null,
    },

    // Snapshots so the cart renders correctly even if the variant is
    // later edited or deactivated.
    variantLabel: {
      type: String,
      default: "",
    },

    sku: {
      type: String,
      default: "",
    },

    quantity: {
      type: Number,
      required: true,
      default: 1,
    },
  },
  { _id: false },
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    items: [cartItemSchema],
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Cart", cartSchema);
