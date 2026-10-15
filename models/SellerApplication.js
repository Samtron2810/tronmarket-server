import mongoose from "mongoose";

// A customer's request to become a seller. One pending application per
// user is enforced in the controller; history is kept so applicants and
// admins can see what was decided and why.
const sellerApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    storeName: { type: String, required: true, trim: true, maxlength: 100 },
    businessDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    contactPhone: { type: String, required: true, trim: true, maxlength: 30 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true },
);

sellerApplicationSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("SellerApplication", sellerApplicationSchema);
