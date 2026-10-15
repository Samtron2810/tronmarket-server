import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Review from "../models/Review.js";

function publicReview(review) {
  return {
    _id: review._id,
    product: review.product,
    rating: review.rating,
    title: review.title,
    body: review.body,
    verifiedPurchase: review.verifiedPurchase,
    isHidden: review.isHidden,
    user: review.user?._id
      ? { _id: review.user._id, name: review.user.name }
      : { name: "Customer" },
    createdAt: review.createdAt,
  };
}

export const listProductReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ product: req.params.id, isHidden: false })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("user", "name")
      .lean();
    const stats = await Review.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(req.params.id), isHidden: false } },
      {
        $group: {
          _id: null,
          average: { $avg: "$rating" },
          count: { $sum: 1 },
          five: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
          four: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
          three: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
          two: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
          one: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
        },
      },
    ]);
    const summary = stats[0] || { average: 0, count: 0, five: 0, four: 0, three: 0, two: 0, one: 0 };
    return res.json({
      reviews: reviews.map(publicReview),
      summary: {
        average: Math.round((summary.average || 0) * 10) / 10,
        count: summary.count,
        breakdown: { 5: summary.five, 4: summary.four, 3: summary.three, 2: summary.two, 1: summary.one },
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load reviews" });
  }
};

export const createOrUpdateReview = async (req, res) => {
  try {
    const productExists = await Product.exists({ _id: req.params.id });
    if (!productExists) return res.status(404).json({ message: "Product not found" });

    const verifiedPurchase = Boolean(
      await Order.exists({
        user: req.user._id,
        "items.product": req.params.id,
        status: "delivered",
      }),
    );

    const review = await Review.findOneAndUpdate(
      { product: req.params.id, user: req.user._id },
      {
        $set: {
          rating: Number(req.body.rating),
          title: String(req.body.title || "").slice(0, 120),
          body: String(req.body.body || "").slice(0, 2000),
          verifiedPurchase,
          isHidden: false,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).populate("user", "name");
    return res.status(201).json(publicReview(review));
  } catch (error) {
    return res.status(400).json({ message: error.message || "Could not save the review" });
  }
};

export const deleteReview = async (req, res) => {
  try {
    const deleted = await Review.findOneAndDelete({ _id: req.params.reviewId, user: req.user._id });
    if (!deleted) return res.status(404).json({ message: "Review not found" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete the review" });
  }
};

// product ids the signed-in user already reviewed (frontend uses this to prefill)
export const myProductReview = async (req, res) => {
  try {
    const review = await Review.findOne({ product: req.params.id, user: req.user._id }).populate("user", "name").lean();
    return res.json(review ? publicReview(review) : null);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load your review" });
  }
};
