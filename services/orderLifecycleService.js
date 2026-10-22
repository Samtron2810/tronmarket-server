// Background sweeper for the order lifecycle. Three rules, all driven by the
// timing policy in orderPolicy.js:
//
//   1. delivery-claimed for too long with no "not received" report → delivered
//   2. delivered for too long with no open report                  → completed
//   3. paid but no package shipped for too long                    → cancelled + refunded
//
// Every change goes through the same fulfilment helpers the staff/buyer routes
// use, and every rule skips packages with an open or upheld report.

import Order from "../models/Order.js";
import Dispute from "../models/Dispute.js";
import {
  effectiveFulfillmentStatus,
  setSellerFulfillmentStatus,
} from "./orderFulfillmentService.js";
import { cancelOrderWithRefund } from "./orderCancellationService.js";
import { POLICY, addDays, daysBefore } from "./orderPolicy.js";

const key = (value) => String(value || "");

async function reportedPackages(orders) {
  if (orders.length === 0) return new Set();
  const rows = await Dispute.find({
    order: { $in: orders.map((o) => o._id) },
    status: { $in: ["open", "upheld"] },
  })
    .select("order seller")
    .lean();
  return new Set(rows.map((r) => `${key(r.order)}:${key(r.seller)}`));
}

function lastStatusAt(fulfillment, status, fallback) {
  const entries = (fulfillment.statusHistory || []).filter((h) => h.status === status);
  return entries.length ? entries[entries.length - 1].changedAt || fallback : fallback;
}

async function moveFulfillment(orderId, sellerId, status, note) {
  const order = await Order.findById(orderId);
  if (!order) return false;
  const fulfillment = (order.sellerFulfillments || []).find((f) => key(f.seller) === key(sellerId));
  if (!fulfillment) return false;

  setSellerFulfillmentStatus(order, sellerId, status, note);
  if (status === "delivered" && !order.deliveredAt && order.status === "delivered") {
    order.deliveredAt = new Date();
  }
  order.statusHistory.push({ status: order.status, note });
  await order.save();
  return true;
}

export async function runLifecycleSweep({ now = new Date(), limit = 200 } = {}) {
  const summary = { confirmed: 0, completed: 0, cancelled: 0, errors: 0 };

  // 1. Seller-claimed deliveries the buyer never reported.
  const claimed = await Order.find({ "sellerFulfillments.status": "delivery-claimed" }).limit(limit);
  const reportedClaimed = await reportedPackages(claimed);
  for (const order of claimed) {
    for (const f of order.sellerFulfillments || []) {
      if (f.status !== "delivery-claimed") continue;
      if (reportedClaimed.has(`${key(order._id)}:${key(f.seller)}`)) continue;
      const at = lastStatusAt(f, "delivery-claimed", order.updatedAt);
      if (addDays(at, POLICY.deliveryConfirmDays) > now) continue;
      try {
        if (await moveFulfillment(order._id, f.seller, "delivered", "Delivery auto-confirmed: no 'not received' report")) {
          summary.confirmed += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.error("lifecycle: auto-confirm failed", String(order._id), error.message);
      }
    }
  }

  // 2. Delivered and undisputed for long enough → completed. Never sooner
  //    than the dispute window, because completion releases the payout.
  const completeAfter = Math.max(POLICY.autoCompleteDays, POLICY.disputeWindowDays);
  const delivered = await Order.find({ "sellerFulfillments.status": "delivered" }).limit(limit);
  const reportedDelivered = await reportedPackages(delivered);
  for (const order of delivered) {
    for (const f of order.sellerFulfillments || []) {
      if (f.status !== "delivered") continue;
      if (reportedDelivered.has(`${key(order._id)}:${key(f.seller)}`)) continue;
      const at = f.deliveredAt || order.deliveredAt || order.updatedAt;
      if (addDays(at, completeAfter) > now) continue;
      try {
        if (await moveFulfillment(order._id, f.seller, "completed", "Auto-completed after the review period")) {
          summary.completed += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.error("lifecycle: auto-complete failed", String(order._id), error.message);
      }
    }
  }

  // 3. Paid, but nothing shipped by the deadline → cancel and refund. Orders
  //    where some packages have already shipped are left alone (a partial
  //    cancel needs partial refunds, which are not built yet).
  const stale = await Order.find({
    isPaid: true,
    status: { $in: ["paid", "processing"] },
    paidAt: { $lte: daysBefore(now, POLICY.shipDeadlineDays) },
  }).limit(limit);
  for (const order of stale) {
    const anyShipped = (order.sellerFulfillments || []).some(
      (f) => !["paid", "processing", "pending", "cancelled"].includes(effectiveFulfillmentStatus(order, f)),
    );
    if (anyShipped) continue;
    try {
      await cancelOrderWithRefund(order, {
        allowedStatuses: ["paid", "processing"],
        note: `Auto-cancelled: not shipped within ${POLICY.shipDeadlineDays} days of payment`,
        refundReason: "Order not shipped in time",
      });
      summary.cancelled += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("lifecycle: auto-cancel failed", String(order._id), error.message);
    }
  }

  return summary;
}

let sweeperTimer = null;
let running = false;

export function startOrderLifecycleSweeper() {
  if (sweeperTimer || process.env.ORDER_LIFECYCLE_SWEEPER === "false") return null;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runLifecycleSweep();
      const changed = summary.confirmed + summary.completed + summary.cancelled;
      if (changed || summary.errors) console.log("Order lifecycle sweep:", summary);
    } catch (error) {
      console.error("Order lifecycle sweep failed:", error.message);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 30 * 1000);
  sweeperTimer = setInterval(run, 10 * 60 * 1000);
  sweeperTimer.unref?.();
  return sweeperTimer;
}
