// Admin moderation of product reviews: list, hide or show, and delete.
// Hidden reviews disappear from the storefront and from the rating; the buyer
// cannot change them. Every action is recorded in the audit log.
import Review from "../models/Review.js";
import { recordAudit } from "../services/auditService.js";
import { syncProductReviewStats } from "../services/reviewStatsService.js";

const STATUS_FILTERS = ["all", "visible", "hidden"];

function adminView(review) {
  return {
    _id: review._id,
    rating: review.rating,
    title: review.title || "",
    body: review.body || review.comment || "",
    verifiedPurchase: Boolean(review.verifiedPurchase),
    isHidden: Boolean(review.isHidden),
    moderationReason: review.moderationReason || "",
    createdAt: review.createdAt,
    product: review.product?._id
      ? { _id: review.product._id, name: review.product.name }
      : { _id: review.product, name: "Deleted product" },
    user: review.user?._id
      ? { _id: review.user._id, name: review.user.name, email: review.user.email }
      : { name: "Deleted user" },
  };
}

export const listAdminReviews = async (req, res) => {
  try {
    const status = STATUS_FILTERS.includes(req.query.status) ? req.query.status : "all";
    const filter = {};
    if (status === "visible") filter.isHidden = { $ne: true };
    if (status === "hidden") filter.isHidden = true;

    const reviews = await Review.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("product", "name")
      .populate("user", "name email")
      .lean();
    return res.json({ reviews: reviews.map(adminView), count: reviews.length });
  } catch (error) {
    return res.status(500).json({ message: "Could not load reviews" });
  }
};

export const setReviewHidden = async (req, res) => {
  try {
    if (typeof req.body?.hidden !== "boolean") {
      return res.status(400).json({ message: "Say whether the review should be hidden (true or false)" });
    }
    const reason = String(req.body.reason || "").trim().slice(0, 300);
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ message: "Review not found" });

    review.isHidden = req.body.hidden;
    review.moderationReason = review.isHidden ? reason : "";
    await review.save();
    await syncProductReviewStats(review.product);
    await recordAudit(
      req,
      review.isHidden ? "review.hide" : "review.show",
      { type: "Review", id: review._id },
      { product: String(review.product), reason },
    );
    return res.json({ success: true, isHidden: review.isHidden });
  } catch (error) {
    return res.status(500).json({ message: "Could not update the review" });
  }
};

export const deleteAdminReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return res.status(404).json({ message: "Review not found" });
    await syncProductReviewStats(review.product);
    await recordAudit(
      req,
      "review.delete",
      { type: "Review", id: review._id },
      { product: String(review.product), rating: review.rating },
    );
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete the review" });
  }
};
