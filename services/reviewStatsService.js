// Keeps a product's stored rating in step with its visible reviews. Called
// whenever a review is posted, deleted, hidden or shown, so the storefront does
// not wait for the ranking job. Hidden reviews never count.
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Review from "../models/Review.js";
import { cacheDel, invalidateProductCache } from "../config/redis.js";

export async function syncProductReviewStats(productId) {
  const [stats] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)), isHidden: { $ne: true } } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const product = await Product.findByIdAndUpdate(
    productId,
    {
      $set: {
        rating: Math.round((stats?.average || 0) * 10) / 10,
        numReviews: stats?.count || 0,
      },
    },
    { new: true },
  ).select("seller");

  if (product) {
    await invalidateProductCache().catch(() => {});
    await cacheDel(`product:single:${product._id}`, `product:seller:${product.seller}`).catch(() => {});
  }
  return product;
}
