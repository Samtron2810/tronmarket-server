import Order from "../models/Order.js";
import { recordAudit } from "../services/auditService.js";
import {
  deriveOrderStatus,
  effectiveFulfillmentStatus,
  ensureSellerFulfillments,
  getSellerFulfillment,
  isMultiSellerOrder,
  sellerOrderView,
} from "../services/orderFulfillmentService.js";
import {
  cancelOrderWithRefund,
  restoreOrderStock,
} from "../services/orderCancellationService.js";
import { refundGoods, remainingGross } from "../services/refundService.js";
import { sendEmailSafe } from "../emails/emailService.js";

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// POST /api/orders/:id/packages/cancel (seller)
// A seller who cannot fulfil their items (out of stock after payment) cancels
// their own package. The buyer keeps the rest of the order.
//
// Order of operations, so money and stock never disagree:
//   1. claim the package as cancelled (conditional on it not being shipped or
//      paid out), so the seller cannot ship it while we refund;
//   2. request the refund for that package's goods; if Paystack refuses, put
//      the package back and report the error;
//   3. restock this seller's lines only;
//   4. re-derive the order status and tell the buyer.
// When it is the last live package, the whole order is cancelled instead,
// with shipping refunded, through the normal cancellation path.
export const cancelSellerPackage = async (req, res) => {
  try {
    if (req.user.role !== "seller") {
      throw httpError(403, "Only the seller of these items can cancel their package");
    }
    const sellerId = req.user._id;
    const order = await Order.findById(req.params.id);
    if (!order) throw httpError(404, "Order not found");
    if (!order.isPaid) throw httpError(409, "Only paid orders have a package to cancel");

    ensureSellerFulfillments(order);
    const fulfillment = getSellerFulfillment(order, sellerId);
    if (!fulfillment) throw httpError(403, "These items are not part of your sales");

    const current = effectiveFulfillmentStatus(order, fulfillment);
    if (!["paid", "processing"].includes(current)) {
      throw httpError(409, `Your items are already ${current}; only items that have not shipped can be cancelled`);
    }
    if (fulfillment.payoutId) throw httpError(409, "This package has already been paid out");

    const reason = String(req.body?.reason || "").trim().slice(0, 300) || "Out of stock";
    const sellerItems = (order.orderItems || []).filter(
      (item) => String(item.seller) === String(sellerId),
    );
    const otherLivePackages = order.sellerFulfillments.filter(
      (f) =>
        String(f.seller) !== String(sellerId) &&
        effectiveFulfillmentStatus(order, f) !== "cancelled",
    );

    // Last live package: this is simply a whole-order cancellation.
    if (!isMultiSellerOrder(order) || otherLivePackages.length === 0) {
      const result = await cancelOrderWithRefund(order, {
        allowedStatuses: ["paid", "processing"],
        note: `Cancelled by seller: ${reason}`,
        refundReason: `Seller cancelled (${reason})`.slice(0, 250),
      });
      await recordAudit(req, "order.seller-cancel", { type: "Order", id: order._id }, { reason });
      const fresh = await Order.findById(order._id);
      return res.json({ order: sellerOrderView(fresh, sellerId), cancelledOrder: true });
    }

    const storedStatus = fulfillment.status;
    const claim = await Order.updateOne(
      {
        _id: order._id,
        sellerFulfillments: {
          $elemMatch: { seller: sellerId, status: storedStatus, payoutId: null },
        },
      },
      {
        $set: { "sellerFulfillments.$.status": "cancelled" },
        $push: {
          "sellerFulfillments.$.statusHistory": {
            status: "cancelled",
            note: `Cancelled by seller: ${reason}`,
            changedAt: new Date(),
          },
        },
      },
    );
    if (!claim.modifiedCount) {
      throw httpError(409, "This package changed while you were cancelling. Refresh and try again.");
    }

    let refund = null;
    try {
      const fresh = await Order.findById(order._id);
      ensureSellerFulfillments(fresh);
      const freshFulfillment = getSellerFulfillment(fresh, sellerId);
      const gross = await remainingGross(fresh, freshFulfillment);
      if (gross > 0) {
        refund = await refundGoods({
          orderId: order._id,
          allocations: [{ seller: sellerId, gross }],
          includeShipping: false,
          kind: "seller-cancel",
          reason: `Seller cancelled their package: ${reason}`,
        });
      }
    } catch (error) {
      // Refund not requested: put the package back so the seller can ship it.
      await Order.updateOne(
        {
          _id: order._id,
          sellerFulfillments: {
            $elemMatch: { seller: sellerId, status: "cancelled", payoutId: null },
          },
        },
        {
          $set: { "sellerFulfillments.$.status": storedStatus },
          $push: {
            "sellerFulfillments.$.statusHistory": {
              status: storedStatus,
              note: "Cancellation not completed: the refund could not be requested",
              changedAt: new Date(),
            },
          },
        },
      );
      throw error;
    }

    await restoreOrderStock({ orderItems: sellerItems });

    const latest = await Order.findById(order._id);
    ensureSellerFulfillments(latest);
    const nextStatus = deriveOrderStatus(latest);
    await Order.updateOne(
      { _id: order._id },
      {
        $set: { status: nextStatus },
        $push: {
          statusHistory: { status: nextStatus, note: `A seller cancelled their package: ${reason}` },
        },
      },
    );

    const after = await Order.findById(order._id);
    if (after?.email) {
      void sendEmailSafe({
        to: after.email,
        subject: "Part of your TronMarket order was cancelled",
        html: `<p>Part of your order was cancelled by the seller (${esc(reason)}).</p>
<p>${refund ? "A refund for those items has been requested from Paystack and will appear on your card or bank account." : "No payment was taken for those items."}</p>
<p>The rest of your order is unaffected. Questions? Email freegram730@gmail.com.</p>`,
      });
    }

    await recordAudit(req, "order.package-cancel", { type: "Order", id: order._id }, {
      seller: String(sellerId),
      reason,
      refund: refund?.status || "none",
    });
    return res.json({
      order: sellerOrderView(after, sellerId),
      refundStatus: refund?.status || "none",
    });
  } catch (error) {
    return res.status(error.status || error.statusCode || 500).json({
      message: error.status || error.statusCode ? error.message : "Could not cancel the package",
    });
  }
};
