import Order from "../models/Order.js";
import Product from "../models/Product.js";
import ProductVariant from "../models/ProductVariant.js";
import { syncProductSummary } from "./variantService.js";
import { invalidateProductCache, cacheDel } from "../config/redis.js";
import { initiateRefundForOrder, paymentError } from "./paymentService.js";

// ─── Order cancellation ─────────────────────────────────────────────────────
// Every cancellation path (customer cancel button, seller/admin status
// change) must do the same three things, in this order:
//
//   1. If the order was paid, get a Paystack refund moving FIRST. If the
//      refund cannot even be requested, the cancellation aborts and the
//      order keeps its status and stock — never "cancelled but paid".
//   2. Atomically claim the pending/paid/processing → cancelled transition
//      so two cancel requests can't restore the same stock twice.
//   3. Only then return the reserved stock (per variant where applicable)
//      and invalidate product caches.

export async function restoreOrderStock(order) {
  if (!order.orderItems?.length) return;

  await Promise.all(
    order.orderItems.map((item) =>
      item.variant
        ? ProductVariant.findByIdAndUpdate(item.variant, {
            $inc: { stock: item.quantity },
          })
        : Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity },
          }),
    ),
  );

  // Variant restocks change the derived product totals.
  for (const pid of [
    ...new Set(order.orderItems.map((i) => i.product.toString())),
  ]) {
    const prod = await Product.findById(pid).select("hasVariants");
    if (prod?.hasVariants) await syncProductSummary(pid);
  }

  const sellerIds = [
    ...new Set(order.orderItems.map((item) => item.seller?.toString())),
  ];

  await invalidateProductCache();
  for (const sellerId of sellerIds) {
    if (sellerId) await cacheDel(`product:seller:${sellerId}`);
  }
  for (const item of order.orderItems) {
    await cacheDel(`product:single:${item.product}`);
  }
}

export async function cancelOrderWithRefund(
  orderInput,
  { allowedStatuses, note = "Order cancelled", refundReason = "Order cancelled" } = {},
) {
  let order = await Order.findById(orderInput?._id || orderInput);
  if (!order) throw paymentError("Order not found", 404);

  if (order.status === "cancelled") {
    return { order, alreadyCancelled: true, refund: null };
  }

  if (!allowedStatuses?.includes(order.status)) {
    throw paymentError(
      `Cannot cancel an order that is already ${order.status}`,
      400,
    );
  }

  let refund = null;
  if (order.isPaid) {
    // Throws (409/502) when no refund can be requested — the caller turns
    // that into an error response and nothing else has been mutated except
    // the order's refundStatus marker, which records the failed attempt.
    refund = await initiateRefundForOrder(order, {
      reason: refundReason,
      expectedStatuses: allowedStatuses,
    });
    order = refund.order;
  }

  // Atomic claim: only the request that actually flips the status restores
  // stock, so double-clicks / parallel cancels can't double-restock.
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: order.status,
      // Orders saved before refundStatus existed have no such field in
      // MongoDB even though Mongoose reports the "none" default — match
      // both so legacy orders can still be cancelled.
      ...(order.refundStatus && order.refundStatus !== "none"
        ? { refundStatus: order.refundStatus }
        : { refundStatus: { $in: ["none", null] } }),
    },
    {
      $set: { status: "cancelled" },
      $push: { statusHistory: { status: "cancelled", note } },
    },
    { new: true },
  );

  if (!claimed) {
    const current = await Order.findById(order._id);
    if (current?.status === "cancelled") {
      return { order: current, alreadyCancelled: true, refund };
    }
    throw paymentError(
      "Order status changed while cancelling; please refresh and try again",
      409,
    );
  }

  await restoreOrderStock(claimed);

  return { order: claimed, alreadyCancelled: false, refund };
}
