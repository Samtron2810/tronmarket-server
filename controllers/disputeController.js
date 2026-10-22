import Order from "../models/Order.js";
import Dispute from "../models/Dispute.js";
import {
  effectiveFulfillmentStatus,
  setSellerFulfillmentStatus,
} from "../services/orderFulfillmentService.js";
import { POLICY, addDays } from "../services/orderPolicy.js";
import { recordAudit } from "../services/auditService.js";
import { refundDisputedPackage } from "../services/refundService.js";

// A buyer's "not received" report, one per seller package. It is allowed
// while the package is with the courier, claimed delivered, or delivered
// within the dispute window. An open report holds that seller's payout.

const REPORTABLE = ["shipped", "delivery-claimed", "delivered"];
const sameId = (a, b) => String(a || "") === String(b || "");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function packageLabel(order, sellerId) {
  const names = (order.orderItems || [])
    .filter((item) => sameId(item.seller, sellerId))
    .map((item) => item.name)
    .filter(Boolean);
  return names.length ? `the package with ${names.slice(0, 2).join(", ")}` : "that package";
}

export const openDispute = async (req, res) => {
  try {
    const { orderId, sellerIds, reason, details } = req.body;
    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const now = new Date();
    const uniqueSellers = [...new Set(sellerIds.map(String))];

    // Validate every package first so a bad selection creates nothing.
    for (const sellerId of uniqueSellers) {
      const fulfillment = (order.sellerFulfillments || []).find((f) => sameId(f.seller, sellerId));
      if (!fulfillment) throw httpError(404, "One of the selected packages is not part of this order");

      const current = effectiveFulfillmentStatus(order, fulfillment);
      if (!REPORTABLE.includes(current)) {
        throw httpError(409, `You can only report ${packageLabel(order, sellerId)} once it has shipped`);
      }
      if (fulfillment.payoutId) {
        throw httpError(409, `${packageLabel(order, sellerId)} has already been paid out`);
      }
      if (current === "delivered") {
        const deliveredAt = fulfillment.deliveredAt || order.deliveredAt || order.updatedAt;
        if (now > addDays(deliveredAt, POLICY.disputeWindowDays)) {
          throw httpError(409, `The report window for ${packageLabel(order, sellerId)} has closed`);
        }
      }
      const existing = await Dispute.exists({ order: order._id, seller: sellerId });
      if (existing) {
        throw httpError(409, `A report already exists for ${packageLabel(order, sellerId)}`);
      }
    }

    const created = [];
    for (const sellerId of uniqueSellers) {
      const dispute = await Dispute.create({
        order: order._id,
        seller: sellerId,
        user: req.user._id,
        reason: String(reason || "").trim().slice(0, 300),
        details: String(details || "").trim().slice(0, 2000),
      });
      created.push(dispute);
    }
    return res.status(201).json(created);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message || "Could not open the report" });
  }
};

export const myDisputes = async (req, res) => {
  try {
    const disputes = await Dispute.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("order", "totalPrice status createdAt")
      .lean();
    return res.json(disputes);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load your reports" });
  }
};

export const listDisputes = async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const disputes = await Dispute.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("user", "name email")
      .populate("seller", "name email")
      .populate("order", "totalPrice status createdAt")
      .lean();
    return res.json(disputes);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load reports" });
  }
};

// "release": the seller's delivery stands and they can be paid.
// "uphold": the buyer's report stands, the seller is not paid for the package.
// Upheld cases refund the seller's goods for that package to the buyer.
export const resolveDispute = async (req, res) => {
  try {
    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) return res.status(404).json({ message: "Report not found" });
    if (dispute.status !== "open") {
      return res.status(409).json({ message: "This report has already been resolved" });
    }

    const { decision } = req.body;
    const note = String(req.body.note || "").slice(0, 1000);
    const order = await Order.findById(dispute.order);
    if (!order) return res.status(409).json({ message: "The linked order no longer exists" });

    if (decision === "release") {
      const fulfillment = (order.sellerFulfillments || []).find((f) => sameId(f.seller, dispute.seller));
      if (fulfillment && effectiveFulfillmentStatus(order, fulfillment) === "delivery-claimed") {
        // The seller's delivery is accepted, so the package counts as delivered.
        setSellerFulfillmentStatus(order, dispute.seller, "delivered", "Delivery accepted after review");
        if (order.status === "delivered" && !order.deliveredAt) order.deliveredAt = new Date();
        order.statusHistory.push({ status: order.status, note: "Report released: seller delivery accepted" });
        await order.save();
      }
      dispute.status = "released";
    } else {
      // Upheld: the seller's goods for that package are refunded first. If the
      // refund cannot be requested the error propagates and the report stays
      // open, so the decision and the money never disagree.
      await refundDisputedPackage(dispute);
      dispute.status = "upheld";
    }

    dispute.adminNote = note;
    dispute.reviewedBy = req.user._id;
    dispute.reviewedAt = new Date();
    await dispute.save();
    await recordAudit(
      req,
      `dispute.${dispute.status}`,
      { type: "Order", id: order._id },
      { dispute: String(dispute._id), seller: String(dispute.seller) },
    );
    return res.json(dispute);
  } catch (error) {
    console.error("resolveDispute:", error);
    if (error.status) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({ message: "Could not resolve the report" });
  }
};
