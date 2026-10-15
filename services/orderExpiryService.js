import Order from "../models/Order.js";
import { cancelOrderWithRefund } from "./orderCancellationService.js";

// ─── Unpaid-order expiry ────────────────────────────────────────────────────
// Placing an order reserves stock immediately (so it can't be oversold),
// but an unpaid order must not hold that stock forever. Orders get a
// payment deadline (default 30 minutes); once it passes, the order is
// cancelled through the normal cancellation path and the stock goes back.
//
// Expiry happens three ways, all idempotent:
//   * a background sweeper every minute (started from server.js),
//   * lazily when the buyer touches the order (list/detail/initialize),
//   * never for paid orders — the sweeper filters on isPaid/status.

export function getPaymentTtlMs() {
  const minutes = Number(process.env.ORDER_PAYMENT_TTL_MINUTES || 30);
  const safeMinutes = Number.isFinite(minutes)
    ? Math.min(24 * 60, Math.max(5, minutes))
    : 30;
  return safeMinutes * 60 * 1000;
}

export function newPaymentDeadline(from = new Date()) {
  return new Date(new Date(from).getTime() + getPaymentTtlMs());
}

// The moment this order stops being payable. Legacy orders have no stored
// deadline; theirs is derived from when they were placed.
export function paymentDeadlineFor(order) {
  if (order?.paymentExpiresAt) return new Date(order.paymentExpiresAt);
  if (order?.createdAt) return newPaymentDeadline(order.createdAt);
  return newPaymentDeadline();
}

export function isOrderExpired(order, now = new Date()) {
  if (!order || order.isPaid || order.status !== "pending") return false;
  return paymentDeadlineFor(order) <= now;
}

export async function expireOrderIfDue(orderInput, { now = new Date() } = {}) {
  let order =
    orderInput && typeof orderInput === "object" && orderInput._id
      ? await Order.findById(orderInput._id)
      : await Order.findById(orderInput);
  if (!order) return { expired: false, order: null };
  if (!isOrderExpired(order, now)) return { expired: false, order };

  // Persist the derived deadline for legacy orders so every path agrees.
  if (!order.paymentExpiresAt) {
    order.paymentExpiresAt = paymentDeadlineFor(order);
    await order.save();
  }

  try {
    const { order: cancelled, alreadyCancelled } =
      await cancelOrderWithRefund(order, {
        allowedStatuses: ["pending"],
        note: "Payment window expired; reserved stock released",
        refundReason: "Payment window expired",
      });

    if (!alreadyCancelled) {
      cancelled.expiredAt = new Date();
      await cancelled.save();
    }
    return { expired: !alreadyCancelled, order: cancelled };
  } catch (error) {
    // Another path cancelled/paid it first — that's a successful outcome.
    if (error?.statusCode === 400 || error?.statusCode === 409) {
      const current = await Order.findById(order._id);
      return { expired: current?.status === "cancelled", order: current };
    }
    throw error;
  }
}

// Expire every due unpaid order (optionally scoped, e.g. to one buyer).
export async function sweepExpiredOrders({ userId = null, limit = 100 } = {}) {
  const now = new Date();
  const legacyCutoff = new Date(now.getTime() - getPaymentTtlMs());

  const filter = {
    status: "pending",
    isPaid: false,
    $or: [
      { paymentExpiresAt: { $lte: now } },
      // Legacy orders: no stored deadline, placed longer ago than the TTL.
      { paymentExpiresAt: { $in: [null, undefined] }, createdAt: { $lte: legacyCutoff } },
      { paymentExpiresAt: { $exists: false }, createdAt: { $lte: legacyCutoff } },
    ],
  };
  if (userId) filter.user = userId;

  const due = await Order.find(filter).sort("paymentExpiresAt").limit(limit);
  let expired = 0;
  for (const order of due) {
    const result = await expireOrderIfDue(order, { now });
    if (result.expired) expired += 1;
  }
  return { scanned: due.length, expired };
}

let sweeperTimer = null;

export function startOrderExpirySweeper() {
  if (sweeperTimer || process.env.ORDER_EXPIRY_SWEEPER === "false") return null;
  if (process.env.NODE_ENV === "test") return null;

  const run = () => {
    sweepExpiredOrders().catch((error) => {
      console.error("Order expiry sweep failed:", error.message);
    });
  };

  // First pass shortly after boot (clears anything that expired while the
  // server was down), then once a minute.
  const initial = setTimeout(run, 10 * 1000);
  initial.unref?.();
  sweeperTimer = setInterval(run, 60 * 1000);
  sweeperTimer.unref?.();
  return sweeperTimer;
}
