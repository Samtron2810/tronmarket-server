import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import Coupon from "../models/Coupon.js";
import ReturnRequest from "../models/ReturnRequest.js";
import Payment from "../models/Payment.js";
import { money } from "../services/pricingService.js";
import { recordAudit } from "../services/auditService.js";
import { initiateRefundForOrder } from "../services/paymentService.js";
import { invalidateProductCache, cacheDel } from "../config/redis.js";

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, rows) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(rows.map((row) => row.map(csvCell).join(",")).join("\r\n"));
}

const PAID_STATUSES = ["paid", "processing", "shipped", "delivered"];

// ── Analytics ────────────────────────────────────────────────────────────────
export const getAnalytics = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalsAgg, series, topProducts, statusAgg, topSellers] = await Promise.all([
      Order.aggregate([
        { $match: { status: { $in: PAID_STATUSES } } },
        {
          $group: {
            _id: null,
            revenue: { $sum: "$totalPrice" },
            commission: { $sum: "$commissionTotal" },
            orders: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: { status: { $in: PAID_STATUSES }, createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$totalPrice" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { status: { $in: PAID_STATUSES } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            name: { $first: "$items.name" },
            units: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 8 },
      ]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { status: { $in: PAID_STATUSES } } },
        { $unwind: "$sellerFulfillments" },
        {
          $group: {
            _id: "$sellerFulfillments.seller",
            revenue: { $sum: "$sellerFulfillments.subtotal" },
            commission: { $sum: "$sellerFulfillments.commissionAmount" },
            payout: { $sum: "$sellerFulfillments.payoutAmount" },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 8 },
      ]),
    ]);

    const [usersCount, productsCount, pendingModeration, openReturns, pendingRefunds] = await Promise.all([
      User.countDocuments({ accountStatus: { $ne: "deleted" } }),
      Product.countDocuments({}),
      Product.countDocuments({ moderationStatus: "pending" }),
      ReturnRequest.countDocuments({ status: { $in: ["requested", "approved"] } }),
      Order.countDocuments({ refundStatus: { $in: ["pending"] } }),
    ]);

    const totals = totalsAgg[0] || { revenue: 0, commission: 0, orders: 0 };
    const sellerIds = topSellers.map((s) => s._id).filter(Boolean);
    const sellers = await User.find({ _id: { $in: sellerIds } }).select("name email").lean();
    const sellerById = new Map(sellers.map((s) => [String(s._id), s]));

    return res.json({
      totals: {
        revenue: money(totals.revenue),
        commission: money(totals.commission),
        paidOrders: totals.orders,
        users: usersCount,
        products: productsCount,
        pendingModeration,
        openReturns,
        pendingRefunds,
        averageOrderValue: totals.orders ? money(totals.revenue / totals.orders) : 0,
      },
      series: series.map((s) => ({ date: s._id, revenue: money(s.revenue), orders: s.orders })),
      topProducts: topProducts.map((p) => ({ product: p._id, name: p.name, units: p.units, revenue: money(p.revenue) })),
      ordersByStatus: Object.fromEntries(statusAgg.map((s) => [s._id, s.count])),
      topSellers: topSellers.map((s) => ({
        seller: s._id,
        name: sellerById.get(String(s._id))?.name || "Seller",
        email: sellerById.get(String(s._id))?.email || "",
        revenue: money(s.revenue),
        commission: money(s.commission),
        sellerPayout: money(s.payout ?? s.revenue - s.commission),
      })),
    });
  } catch (error) {
    console.error("getAnalytics:", error);
    return res.status(500).json({ message: "Failed to load analytics" });
  }
};

// ── Moderation ───────────────────────────────────────────────────────────────
export const moderationQueue = async (req, res) => {
  try {
    const products = await Product.find({
      moderationStatus: req.query.status === "rejected" ? "rejected" : "pending",
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate("seller", "name email sellerVerified")
      .lean();
    return res.json(products);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load moderation queue" });
  }
};

export const moderateProduct = async (req, res) => {
  try {
    const decision = req.body?.decision === "reject" ? "rejected" : "approved";
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    product.moderationStatus = decision;
    product.moderationNote = decision === "rejected" ? String(req.body?.note || "").slice(0, 500) : "";
    if (decision === "rejected") product.isActive = false;
    await product.save();
    await invalidateProductCache();
    await cacheDel(`product:single:${product._id}`, `product:seller:${product.seller}`).catch(() => {});
    await recordAudit(req, `product.moderation.${decision}`, { type: "Product", id: product._id }, { note: product.moderationNote });
    return res.json({ success: true, moderationStatus: decision });
  } catch (error) {
    return res.status(500).json({ message: "Could not moderate this product" });
  }
};

// ── Coupons ────────────────────────────────────────────────────────────────────
export const listCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).limit(200).lean();
    return res.json(coupons);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load coupons" });
  }
};

export const createCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.create({
      code: String(req.body.code || "").trim().toUpperCase(),
      type: req.body.type === "fixed" ? "fixed" : "percent",
      value: Number(req.body.value),
      minSubtotal: Number(req.body.minSubtotal) || 0,
      maxUsage: Number(req.body.maxUsage) || 0,
      startsAt: req.body.startsAt || null,
      expiresAt: req.body.expiresAt || null,
      isActive: req.body.isActive !== false,
    });
    await recordAudit(req, "coupon.create", { type: "Coupon", id: coupon._id }, { code: coupon.code });
    return res.status(201).json(coupon);
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "That coupon code already exists" });
    return res.status(400).json({ message: error.message || "Could not create coupon" });
  }
};

export const updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      {
        ...(req.body.type ? { type: req.body.type === "fixed" ? "fixed" : "percent" } : {}),
        ...(req.body.value !== undefined ? { value: Number(req.body.value) } : {}),
        ...(req.body.minSubtotal !== undefined ? { minSubtotal: Number(req.body.minSubtotal) } : {}),
        ...(req.body.maxUsage !== undefined ? { maxUsage: Number(req.body.maxUsage) } : {}),
        ...(req.body.startsAt !== undefined ? { startsAt: req.body.startsAt || null } : {}),
        ...(req.body.expiresAt !== undefined ? { expiresAt: req.body.expiresAt || null } : {}),
        ...(req.body.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
      },
      { new: true },
    );
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });
    await recordAudit(req, "coupon.update", { type: "Coupon", id: coupon._id }, { code: coupon.code });
    return res.json(coupon);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Could not update coupon" });
  }
};

export const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });
    await recordAudit(req, "coupon.delete", { type: "Coupon", id: coupon._id }, { code: coupon.code });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete coupon" });
  }
};

// ── Returns / disputes ─────────────────────────────────────────────────────────
export const listReturns = async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const returns = await ReturnRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("user", "name email")
      .populate("order", "totalPrice status email createdAt")
      .lean();
    return res.json(returns);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load return requests" });
  }
};

export const reviewReturn = async (req, res) => {
  try {
    const request = await ReturnRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Return request not found" });
    const decision = req.body?.decision;
    if (!["approve", "reject", "refund"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approve, reject or refund" });
    }
    if (request.status === "refunded" || request.status === "rejected") {
      return res.status(409).json({ message: "This return has already been closed" });
    }

    if (decision === "reject") {
      request.status = "rejected";
      request.adminNote = String(req.body?.note || "").slice(0, 500);
      request.reviewedBy = req.user._id;
      await request.save();
      await recordAudit(req, "return.reject", { type: "ReturnRequest", id: request._id }, {});
      return res.json(request);
    }

    if (decision === "approve") {
      request.status = "approved";
      request.adminNote = String(req.body?.note || "").slice(0, 500);
      request.reviewedBy = req.user._id;
      await request.save();
      await recordAudit(req, "return.approve", { type: "ReturnRequest", id: request._id }, {});
      return res.json(request);
    }

    // refund: the order must be a paid order; reuse the money-path refund.
    const orderResult = await requestOrderForRefund(request);
    if (orderResult.error) return res.status(orderResult.error.status).json({ message: orderResult.error.message });

    const payment = await Payment.findOne({ order: orderResult.doc._id }).sort({ createdAt: -1 });
    if (!payment?.reference) {
      return res.status(409).json({ message: "No Paystack payment reference exists for this order" });
    }

    const refund = await initiateRefundForOrder(orderResult.doc, {
      reason: `Return ${request._id}: ${request.reason}`.slice(0, 250),
      payment,
      expectedStatuses: PAID_STATUSES,
    });

    request.status = refund.status === "processed" ? "refunded" : "approved";
    request.refundReference = refund.payment?.refundReference || payment.reference;
    request.adminNote = String(req.body?.note || "").slice(0, 500);
    request.reviewedBy = req.user._id;
    await request.save();
    await recordAudit(req, "return.refund", { type: "ReturnRequest", id: request._id }, { order: String(orderResult.doc._id), state: refund.status });
    return res.json({ ...request.toObject(), refundState: refund.status });
  } catch (error) {
    console.error("reviewReturn:", error);
    return res.status(500).json({ message: error.message || "Could not process this return" });
  }
};

async function requestOrderForRefund(request) {
  const doc = await mongoose.model("Order").findById(request.order);
  if (!doc) return { error: { status: 409, message: "The linked order no longer exists" } };
  if (!PAID_STATUSES.includes(doc.status)) {
    return { error: { status: 409, message: "Only paid orders can be refunded from a return" } };
  }
  return { doc };
}

// ── Refund queue ────────────────────────────────────────────────────────────────
export const refundQueue = async (req, res) => {
  try {
    const payments = await Payment.find({
      status: { $in: ["requires_refund", "refund_pending", "refund_failed"] },
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate("order", "totalPrice status email createdAt")
      .populate("user", "name email")
      .lean();
    return res.json(payments);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load the refund queue" });
  }
};

// ── Exports ─────────────────────────────────────────────────────────────────────
export const exportOrdersCsv = async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(2000).lean();
    const rows = [["orderId", "createdAt", "email", "status", "paymentStatus", "itemsSubtotal", "discount", "coupon", "shippingPrice", "totalPrice", "commissionTotal", "refundStatus"]];
    for (const o of orders) {
      rows.push([o._id, o.createdAt?.toISOString(), o.email, o.status, o.paymentStatus, o.itemsSubtotal ?? o.totalAmount, o.discountAmount || 0, o.couponCode || "", o.shippingPrice || 0, o.totalPrice, o.commissionTotal || 0, o.refundStatus || "none"]);
    }
    return sendCsv(res, "orders.csv", rows);
  } catch (error) {
    return res.status(500).json({ message: "Export failed" });
  }
};

export const exportProductsCsv = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).limit(5000).populate("seller", "email").lean();
    const rows = [["productId", "name", "brand", "category", "price", "countInStock", "isActive", "isDraft", "moderationStatus", "sellerEmail", "createdAt"]];
    for (const p of products) {
      rows.push([p._id, p.name, p.brand || "", p.category || "", p.price, p.countInStock, p.isActive, p.isDraft, p.moderationStatus, p.seller?.email || "", p.createdAt?.toISOString()]);
    }
    return sendCsv(res, "products.csv", rows);
  } catch (error) {
    return res.status(500).json({ message: "Export failed" });
  }
};

export const exportUsersCsv = async (req, res) => {
  try {
    const users = await User.find({ accountStatus: { $ne: "deleted" } }).sort({ createdAt: -1 }).limit(5000).lean();
    const rows = [["userId", "name", "email", "role", "isVerified", "sellerVerified", "createdAt"]];
    for (const u of users) rows.push([u._id, u.name, u.email, u.role, u.isVerified, u.sellerVerified, u.createdAt?.toISOString()]);
    return sendCsv(res, "users.csv", rows);
  } catch (error) {
    return res.status(500).json({ message: "Export failed" });
  }
};

// ── Bulk product actions ───────────────────────────────────────────────────────
export const bulkProducts = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 100);
    const action = req.body?.action;
    if (!ids.length) return res.status(400).json({ message: "Select at least one product" });

    const updatesByAction = {
      activate: { isActive: true, isDraft: false },
      deactivate: { isActive: false },
      draft: { isDraft: true, isActive: false },
      feature: { isFeatured: true },
      unfeature: { isFeatured: false },
      // Paid promotion window: sponsoring grants 30 days of top-tier
      // ranking (see services/productRankingService.js).
      sponsor: {
        isSponsored: true,
        sponsoredUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      unsponsor: { isSponsored: false, sponsoredUntil: null },
    };
    if (action === "delete") {
      const result = await Product.deleteMany({ _id: { $in: ids } });
      await invalidateProductCache();
      await recordAudit(req, "product.bulk.delete", { type: "Product" }, { count: result.deletedCount });
      return res.json({ success: true, affected: result.deletedCount });
    }
    const updates = updatesByAction[action];
    if (!updates) return res.status(400).json({ message: "Unknown bulk action" });
    const result = await Product.updateMany({ _id: { $in: ids } }, { $set: updates });
    await invalidateProductCache();
    await Promise.all(ids.map((id) => cacheDel(`product:single:${id}`).catch(() => {})));
    await recordAudit(req, `product.bulk.${action}`, { type: "Product" }, { count: result.modifiedCount });
    return res.json({ success: true, affected: result.modifiedCount });
  } catch (error) {
    return res.status(500).json({ message: "Bulk action failed" });
  }
};

// Seller verification badge toggle.
export const setSellerVerified = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.sellerVerified = Boolean(req.body?.sellerVerified);
    await user.save();
    await recordAudit(req, "user.seller_verified", { type: "User", id: user._id }, { sellerVerified: user.sellerVerified });
    return res.json({ _id: user._id, sellerVerified: user.sellerVerified });
  } catch (error) {
    return res.status(500).json({ message: "Could not update seller verification" });
  }
};
