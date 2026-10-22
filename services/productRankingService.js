// ─── Product Ranking & Display System ─────────────────────────────
// Every product carries a rankingScore. Storefront lists in the default
// "Recommended" sort order by that score, which is what makes the
// homepage / category / search order STABLE: the score is recomputed
// only by this hourly background job, never during a page load, so
// refreshing the homepage shows essentially the same arrangement for
// hours. (Recommendation rails like "Related products" deliberately
// shuffle instead — see getRelatedProducts.)
//
// Score composition (higher = shown earlier):
//   Sponsored (paid promotion, admin-set, unexpired) ... +10,000
//   Featured (admin-pinned) ............................ +1,000
//   Sales performance .................................. log-scaled, up to ~+200
//   Rating (confidence-weighted by review count) ....... up to ~+100
//   Views .............................................. log-scaled, up to ~+30
//   Freshness / new-product boost ...................... up to +50, decaying
//                                                        linearly to 0 over
//                                                        the first 7 days
//   In stock ........................................... +10
//   Out of stock ....................................... −100 (sink, not hide)
//
// The tiers are deliberately far apart: money (sponsored) beats admin
// curation (featured), which beats organic performance; the freshness
// boost is large enough to lift a brand-new product off the bottom but
// far too small to leapfrog established sellers — fairness without
// chaos.

import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";

export const RANKING_WEIGHTS = {
  sponsored: 10000,
  featured: 1000,
  salesLogScale: 40,
  ratingMax: 100,
  viewsLogScale: 4,
  freshnessMax: 50,
  freshnessWindowDays: 7,
  inStock: 10,
  outOfStock: -100,
};

export function isSponsorshipActive(product, now = new Date()) {
  if (!product?.isSponsored) return false;
  if (!product.sponsoredUntil) return true;
  return new Date(product.sponsoredUntil) > now;
}

// Pure score computation — exported for reuse/testing. `product` needs
// isSponsored, sponsoredUntil, isFeatured, salesCount, viewCount,
// rating, numReviews, stock, createdAt.
export function computeRankingScore(product, now = new Date()) {
  const w = RANKING_WEIGHTS;
  let score = 0;

  if (isSponsorshipActive(product, now)) score += w.sponsored;
  if (product.isFeatured) score += w.featured;

  // Performance: sales dominate, then confidence-weighted rating, then
  // views. Log scales stop one viral product from crushing the field
  // forever while still rewarding genuine traction.
  score += Math.log1p(Math.max(0, product.salesCount || 0)) * w.salesLogScale;

  const reviews = Math.max(0, product.numReviews || 0);
  const confidence = reviews / (reviews + 10); // 10 reviews ≈ half trust
  score += Math.min(5, Math.max(0, product.rating || 0)) * 20 * confidence;

  score += Math.log1p(Math.max(0, product.viewCount || 0)) * w.viewsLogScale;

  // Freshness: every new product gets a temporary lift for its first
  // week so new/small vendors are discoverable instead of buried.
  const ageDays = Math.max(
    0,
    (now.getTime() - new Date(product.createdAt || now).getTime()) / 86400000,
  );
  if (ageDays < w.freshnessWindowDays) {
    score += (1 - ageDays / w.freshnessWindowDays) * w.freshnessMax;
  }

  score += (product.stock || 0) > 0 ? w.inStock : w.outOfStock;

  return Math.round(score * 100) / 100;
}

// Recompute sales/rating signals from the source-of-truth collections,
// then every product's score. Runs on the hourly job; written with
// bulkWrite so a big catalogue stays one round-trip per batch.
export async function recalculateProductRankings() {
  const now = new Date();

  const [salesRows, reviewRows, products] = await Promise.all([
    Order.aggregate([
      // A "sale" is a paid order that was not cancelled.
      { $match: { isPaid: true, status: { $nin: ["cancelled"] } } },
      { $unwind: "$orderItems" },
      {
        $group: {
          _id: "$orderItems.product",
          sales: { $sum: { $ifNull: ["$orderItems.quantity", 1] } },
        },
      },
    ]),
    Review.aggregate([
      { $match: { isHidden: { $ne: true } } },
      {
        $group: {
          _id: "$product",
          average: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]),
    Product.find(
      {},
      {
        isSponsored: 1,
        sponsoredUntil: 1,
        isFeatured: 1,
        salesCount: 1,
        viewCount: 1,
        rating: 1,
        numReviews: 1,
        stock: 1,
        createdAt: 1,
        rankingScore: 1,
      },
    ).lean(),
  ]);

  const salesById = new Map(salesRows.map((r) => [String(r._id), r.sales || 0]));
  const reviewsById = new Map(
    reviewRows.map((r) => [
      String(r._id),
      {
        rating: Math.round((r.average || 0) * 10) / 10,
        numReviews: r.count || 0,
      },
    ]),
  );

  const ops = [];
  for (const product of products) {
    const id = String(product._id);
    const salesCount = salesById.get(id) || 0;
    const reviewStats = reviewsById.get(id) || { rating: 0, numReviews: 0 };
    const rankingScore = computeRankingScore(
      { ...product, salesCount, ...reviewStats },
      now,
    );

    const changed =
      product.salesCount !== salesCount ||
      product.rating !== reviewStats.rating ||
      product.numReviews !== reviewStats.numReviews ||
      product.rankingScore !== rankingScore;
    if (!changed) continue;

    ops.push({
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            salesCount,
            rating: reviewStats.rating,
            numReviews: reviewStats.numReviews,
            rankingScore,
            rankingUpdatedAt: now,
          },
        },
      },
    });
  }

  if (ops.length) await Product.bulkWrite(ops, { ordered: false });
  return { scanned: products.length, updated: ops.length };
}

// Hourly background recalculation, following the same pattern as the
// other background jobs (opt out with PRODUCT_RANKING_JOB=false).
let rankingTimer = null;

export function startProductRankingJob() {
  if (rankingTimer || process.env.PRODUCT_RANKING_JOB === "false") return null;
  if (process.env.NODE_ENV === "test") return null;

  const run = () => {
    recalculateProductRankings()
      .then(({ scanned, updated }) => {
        if (updated) {
          console.log(
            `Product ranking: recalculated scores (${updated}/${scanned} products updated)`,
          );
        }
      })
      .catch((error) => {
        console.error("Product ranking recalculation failed:", error.message);
      });
  };

  // First pass shortly after boot so fresh installs/legacy products get
  // scores quickly, then once an hour.
  const initial = setTimeout(run, 20 * 1000);
  initial.unref?.();
  rankingTimer = setInterval(run, 60 * 60 * 1000);
  rankingTimer.unref?.();
  return rankingTimer;
}
