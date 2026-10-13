// ─── Per-seller fulfilment ──────────────────────────────────────────────────
// A buyer places (and pays for) ONE order, but that order can contain items
// from several sellers. Each seller gets a fulfilment record holding only
// their own status and subtotal:
//
//   * seller-facing reads (order list, order detail) are filtered down to
//     the seller's own items and subtotal — never the whole order;
//   * a seller can only advance their own fulfilment (ship / claim), never
//     another seller's, and cannot cancel a multi-seller order (the buyer
//     or an admin cancels the whole order so payment is handled once);
//   * the order-level status the buyer sees is DERIVED from the fulfilment
//     statuses, so "shipped" means every seller has shipped.
//
// Legacy orders created before fulfilments existed are backfilled in memory
// from their items + global status the first time they are touched.

import { commissionFor, getCommissionRate, money } from "./pricingService.js";

const ACTIVE_LIKE = [
  "paid",
  "processing",
  "shipped",
  "delivery-claimed",
  "delivered",
  "completed",
];

function sellerKey(value) {
  return value ? value.toString() : "";
}

export function groupOrderItemsBySeller(orderItems = []) {
  const groups = new Map();
  for (const item of orderItems) {
    const key = sellerKey(item.seller);
    if (!groups.has(key)) {
      groups.set(key, { seller: item.seller || null, items: [], subtotal: 0 });
    }
    const group = groups.get(key);
    group.items.push(item);
    group.subtotal += Number(item.price || 0) * Number(item.quantity || 0);
  }
  return [...groups.values()];
}

export function buildSellerFulfillments(orderItems = [], status = "pending") {
  const rate = getCommissionRate();
  return groupOrderItemsBySeller(orderItems).map((group) => ({
    seller: group.seller,
    status,
    subtotal: money(group.subtotal),
    ...commissionFor(group.subtotal, rate),
    payoutStatus: status === "cancelled" ? "cancelled" : "not-eligible",
    statusHistory: [{ status, note: "Order placed" }],
  }));
}

export function payoutStatusFor(order, fulfillment) {
  if (!fulfillment) return "not-eligible";
  if (fulfillment.payoutStatus === "paid") return "paid";
  const status = effectiveFulfillmentStatus(order, fulfillment);
  if (order?.status === "cancelled" || status === "cancelled") {
    return "cancelled";
  }
  if (order?.isPaid && ["delivered", "completed"].includes(status)) {
    return "eligible";
  }
  return "not-eligible";
}

function initialFulfillmentStatus(order) {
  if (!order) return "pending";
  if (order.status === "cancelled") return "cancelled";
  if (!order.isPaid) return "pending";
  if (["paid", "processing", "shipped", "delivery-claimed", "delivered", "completed"].includes(order.status)) {
    return order.status;
  }
  return "paid";
}

// The status a fulfilment should be treated as right now. Stored statuses
// can lag the order-level state (e.g. payment flips the order to "paid"
// without touching fulfilments), so reads go through here.
export function effectiveFulfillmentStatus(order, fulfillment) {
  if (!fulfillment) return order?.status || "pending";
  if (order.status === "cancelled") return "cancelled";
  if (!order.isPaid && order.status === "pending") return "pending";
  // Payment flips the order to paid without touching fulfilment rows; a
  // still-"pending" fulfilment on a paid order is really awaiting action.
  if (fulfillment.status === "pending" && order.isPaid) return "paid";
  if (order.status === "completed" && fulfillment.status !== "cancelled") {
    return "completed";
  }
  return fulfillment.status || "pending";
}

// Make sure every seller in the order has a fulfilment record with an
// up-to-date subtotal. Mutates the (Mongoose) order document; callers save.
export function ensureSellerFulfillments(order) {
  if (!order) return [];
  const groups = groupOrderItemsBySeller(order.orderItems || []);
  if (!Array.isArray(order.sellerFulfillments)) order.sellerFulfillments = [];

  for (const group of groups) {
    const key = sellerKey(group.seller);
    let fulfillment = order.sellerFulfillments.find(
      (f) => sellerKey(f.seller) === key,
    );
    if (!fulfillment) {
      order.sellerFulfillments.push({
        seller: group.seller,
        status: initialFulfillmentStatus(order),
        subtotal: money(group.subtotal),
        ...commissionFor(
          group.subtotal,
          order.commissionRate ?? getCommissionRate(),
        ),
        payoutStatus: "not-eligible",
        statusHistory: [
          {
            status: initialFulfillmentStatus(order),
            note: "Fulfilment created",
          },
        ],
      });
      fulfillment = order.sellerFulfillments[order.sellerFulfillments.length - 1];
    }
    fulfillment.subtotal = money(group.subtotal);
    const rate =
      fulfillment.commissionRate ?? order.commissionRate ?? getCommissionRate();
    const split = commissionFor(group.subtotal, rate);
    fulfillment.commissionRate = split.commissionRate;
    fulfillment.commissionAmount = split.commissionAmount;
    fulfillment.payoutAmount = split.payoutAmount;
    fulfillment.payoutStatus = payoutStatusFor(order, fulfillment);
  }

  // Keep order-level money snapshots in step for legacy orders that were
  // created before items/shipping/commission were separated.
  if ("itemsSubtotal" in order && !order.itemsSubtotal) {
    order.itemsSubtotal = money(
      groups.reduce((sum, group) => sum + group.subtotal, 0),
    );
  }
  if ("commissionTotal" in order) {
    order.commissionTotal = money(
      order.sellerFulfillments.reduce(
        (sum, f) => sum + Number(f.commissionAmount || 0),
        0,
      ),
    );
  }
  if ("sellerPayoutTotal" in order) {
    order.sellerPayoutTotal = money(
      order.sellerFulfillments.reduce(
        (sum, f) => sum + Number(f.payoutAmount || 0),
        0,
      ),
    );
  }

  return order.sellerFulfillments;
}

export function getSellerFulfillment(order, sellerId) {
  ensureSellerFulfillments(order);
  return (
    order.sellerFulfillments.find(
      (f) => sellerKey(f.seller) === sellerKey(sellerId),
    ) || null
  );
}

export function isMultiSellerOrder(order) {
  return groupOrderItemsBySeller(order?.orderItems || []).length > 1;
}

// Recompute the buyer-facing order status from fulfilment statuses.
export function deriveOrderStatus(order) {
  ensureSellerFulfillments(order);
  if (!order.isPaid && order.status === "pending") return "pending";

  const active = order.sellerFulfillments
    .map((f) => effectiveFulfillmentStatus(order, f))
    .filter((s) => s !== "cancelled");

  if (active.length === 0) return "cancelled";
  if (active.every((s) => s === "completed")) return "completed";
  if (active.every((s) => ["delivered", "completed"].includes(s))) {
    return "delivered";
  }
  if (
    active.every((s) =>
      ["shipped", "delivery-claimed", "delivered", "completed"].includes(s),
    )
  ) {
    return active.some((s) => s === "delivery-claimed") &&
      !active.some((s) => ["delivered", "completed"].includes(s))
      ? "delivery-claimed"
      : "shipped";
  }
  if (
    active.some((s) =>
      ["processing", "shipped", "delivery-claimed", "delivered", "completed"].includes(s),
    )
  ) {
    return "processing";
  }
  return order.isPaid ? "paid" : "pending";
}

// Advance one seller's fulfilment and re-derive the order status.
export function setSellerFulfillmentStatus(order, sellerId, status, note) {
  const fulfillment = getSellerFulfillment(order, sellerId);
  if (!fulfillment) return null;
  fulfillment.status = status;
  fulfillment.statusHistory = fulfillment.statusHistory || [];
  fulfillment.statusHistory.push({ status, note: note || "" });
  order.status = deriveOrderStatus(order);
  return fulfillment;
}

// The seller-safe view of an order: only their items, their subtotal as the
// total, and their fulfilment status as the status.
export function sellerOrderView(order, sellerId) {
  const plain =
    typeof order.toObject === "function"
      ? order.toObject()
      : JSON.parse(JSON.stringify(order));

  ensureSellerFulfillments(order);
  const fulfillment = getSellerFulfillment(order, sellerId);
  const items = (plain.orderItems || []).filter(
    (item) => sellerKey(item.seller) === sellerKey(sellerId),
  );
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const status = fulfillment
    ? effectiveFulfillmentStatus(order, fulfillment)
    : plain.status;

  return {
    ...plain,
    orderItems: items,
    // Sellers see their own money, never the whole order's total.
    totalPrice: subtotal,
    sellerSubtotal: subtotal,
    sellerCommissionRate: fulfillment?.commissionRate ?? 0,
    sellerCommissionAmount: fulfillment?.commissionAmount ?? 0,
    sellerPayoutAmount:
      fulfillment?.payoutAmount ?? subtotal,
    payoutStatus: payoutStatusFor(plain, fulfillment),
    sellerStatus: status,
    status,
    sellerFulfillments: fulfillment
      ? [
          {
            seller: fulfillment.seller,
            status,
            subtotal,
            commissionRate: fulfillment.commissionRate ?? 0,
            commissionAmount: fulfillment.commissionAmount ?? 0,
            payoutAmount: fulfillment.payoutAmount ?? subtotal,
            payoutStatus: payoutStatusFor(plain, fulfillment),
            statusHistory: fulfillment.statusHistory || [],
          },
        ]
      : [],
    isSellerView: true,
  };
}
