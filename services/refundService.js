// ─── Refund engine ──────────────────────────────────────────────────────────
// Every money movement back to a buyer goes through here. It replaces the old
// "refund the whole payment once" assumption with a ledger of Refund rows:
//
//   * a payment can be refunded in several pieces, but the pieces (pending or
//     processed) can never add up to more than was charged;
//   * a refund covers goods (allocations) per seller, at the goods value before
//     the order discount. The buyer gets that share of the discounted price;
//     shipping is only refunded when the whole order is being cancelled;
//   * once a refund is PROCESSED its goods are taken off the seller's fulfilment
//     (refundedSubtotal), and commission and payout are recomputed on the rest.
//     A package that is still refund-pending holds its payout (see
//     payoutLedgerService / payoutController);
//   * Paystack webhooks and the reconciliation sweeper both move a refund from
//     pending to processed or failed through applyProviderRefundStatus, and the
//     allocation is applied exactly once (claim on adjustedAt).
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import Refund from "../models/Refund.js";
import paystackApi from "../config/paystack.js";
import { money } from "./pricingService.js";
import { ensureSellerFulfillments } from "./orderFulfillmentService.js";

const CURRENCY = "NGN";
const SUCCESSFUL = ["processed", "success", "succeeded"];

export function refundError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status; // paymentError() callers read statusCode
  return error;
}

const kobo = (naira) => Math.round(Number(naira || 0) * 100);
const naira = (amountKobo) => Math.round(Number(amountKobo || 0)) / 100;
const sameId = (a, b) => String(a || "") === String(b || "");

// Share of the goods value the buyer actually paid for, after the order discount.
export function discountRatio(order) {
  const items =
    Number(order.itemsSubtotal) ||
    (order.orderItems || []).reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0,
    );
  const discount = Number(order.discountAmount) || 0;
  if (!items || discount <= 0) return 0;
  return Math.min(1, discount / items);
}

export function goodsRefundAmount(order, grossNaira) {
  return money(Number(grossNaira) * (1 - discountRatio(order)));
}

// Sum of refunds (in kobo) booked against one Paystack transaction.
export async function refundedKobo(paymentReference, { statuses = ["pending", "processed"] } = {}) {
  const rows = await Refund.find({ paymentReference, status: { $in: statuses } })
    .select("amount")
    .lean();
  return rows.reduce((sum, row) => sum + kobo(row.amount), 0);
}

// Goods value a seller can still have refunded: not yet refunded, and not
// already promised to a pending refund.
export async function remainingGross(order, fulfillment) {
  const pending = await Refund.find({
    order: order._id,
    status: "pending",
    "allocations.seller": fulfillment.seller,
  })
    .select("allocations")
    .lean();
  let pendingGross = 0;
  for (const refund of pending) {
    for (const line of refund.allocations || []) {
      if (sameId(line.seller, fulfillment.seller)) pendingGross += Number(line.gross || 0);
    }
  }
  const gross =
    Number(fulfillment.subtotal || 0) -
    Number(fulfillment.refundedSubtotal || 0) -
    pendingGross;
  return money(Math.max(0, gross));
}

// The Payment row for an order's charge. Orders paid before Payment rows
// existed carry their reference on the order, so that binding is recreated.
export async function paymentForOrder(order) {
  let payment = null;
  if (order.paymentReference) {
    payment = await Payment.findOne({ reference: order.paymentReference });
  }
  if (!payment) {
    payment = await Payment.findOne({
      order: order._id,
      status: { $in: ["success", "requires_refund", "refund_failed", "refunded", "refund_pending"] },
    }).sort({ createdAt: -1 });
  }
  if (!payment && order.paymentReference) {
    try {
      payment = await Payment.create({
        order: order._id,
        user: order.user,
        amount: order.totalPrice,
        currency: CURRENCY,
        reference: order.paymentReference,
        status: "success",
        paidAt: order.paidAt || new Date(),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      payment = await Payment.findOne({ reference: order.paymentReference });
    }
  }
  return payment;
}

async function requestPaystackRefund({ paymentReference, amountKobo, reason, orderId }) {
  try {
    const response = await paystackApi.post("/refund", {
      transaction: paymentReference,
      amount: amountKobo,
      currency: CURRENCY,
      customer_note: reason,
      merchant_note: `TronMarket refund for order ${orderId}`,
    });
    if (!response.data?.status || !response.data?.data) {
      throw new Error(response.data?.message || "Paystack rejected the refund");
    }
    return response.data.data;
  } catch (error) {
    throw refundError(
      error.response?.data?.message || error.message || "Paystack refund request failed",
      502,
    );
  }
}

// Keeps the Payment row's status in step with its refund rows.
async function syncPaymentStatus(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) return;
  const processed = await refundedKobo(payment.reference, { statuses: ["processed"] });
  const pending = await refundedKobo(payment.reference, { statuses: ["pending"] });
  const total = kobo(payment.amount);

  if (total > 0 && processed >= total) {
    payment.status = "refunded";
  } else if (pending > 0) {
    payment.status = "refund_pending";
  } else if (processed > 0) {
    if (["refunded", "refund_pending", "refund_failed"].includes(payment.status)) {
      payment.status = "success";
    }
  } else {
    const last = await Refund.findOne({ paymentReference: payment.reference })
      .sort({ createdAt: -1 })
      .lean();
    if (last?.status === "failed") payment.status = "refund_failed";
  }
  await payment.save();
}

// Keeps the order-level refundStatus in step with its refund rows. Charge
// mismatches are excluded: they never touch the order itself.
export async function syncOrderRefundStatus(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return null;
  const refunds = await Refund.find({
    order: orderId,
    kind: { $ne: "charge-mismatch" },
  })
    .sort({ createdAt: 1 })
    .lean();

  const processed = refunds.filter((r) => r.status === "processed");
  const processedKobo = processed.reduce((sum, r) => sum + kobo(r.amount), 0);
  const anyPending = refunds.some((r) => r.status === "pending");
  const lastFailed = refunds.length > 0 && refunds[refunds.length - 1].status === "failed";
  const totalKobo = kobo(order.totalPrice);

  let refundStatus = "none";
  if (anyPending) refundStatus = "pending";
  else if (processedKobo > 0 && processedKobo >= totalKobo) refundStatus = "processed";
  else if (processedKobo > 0) refundStatus = "partial";
  else if (lastFailed) refundStatus = "failed";

  const $set = { refundStatus, refundAmount: naira(processedKobo) };
  const latest = processed[processed.length - 1];
  if (latest) {
    $set.refundReference = latest.reference || "";
    $set.refundedAt = latest.processedAt || new Date();
  }
  await Order.updateOne({ _id: orderId }, { $set });
  return refundStatus;
}

// Re-derives one seller's commission and payout after a refund changed what
// they are owed. Writes only that seller's fulfilment and the order totals.
async function refreshPayout(orderId, sellerId) {
  const order = await Order.findById(orderId);
  if (!order) return;
  ensureSellerFulfillments(order);
  const fulfillment = order.sellerFulfillments.find((f) => sameId(f.seller, sellerId));
  if (!fulfillment) return;

  const $set = {
    "sellerFulfillments.$.commissionRate": fulfillment.commissionRate,
    "sellerFulfillments.$.commissionAmount": fulfillment.commissionAmount,
    "sellerFulfillments.$.payoutAmount": fulfillment.payoutAmount,
    "sellerFulfillments.$.payoutStatus": fulfillment.payoutStatus,
  };
  if (order.commissionTotal !== undefined) $set.commissionTotal = order.commissionTotal;
  if (order.sellerPayoutTotal !== undefined) $set.sellerPayoutTotal = order.sellerPayoutTotal;
  if (order.itemsSubtotal !== undefined) $set.itemsSubtotal = order.itemsSubtotal;

  await Order.updateOne(
    { _id: orderId, "sellerFulfillments.seller": sellerId },
    { $set },
  );
}

// Takes a PROCESSED refund's goods off the fulfilments. Claimed once, so a
// webhook and the sweeper racing on the same refund cannot apply it twice.
export async function applyRefundAllocations(refund) {
  const claim = await Refund.updateOne(
    { _id: refund._id, adjustedAt: null },
    { $set: { adjustedAt: new Date() } },
  );
  if (!claim.modifiedCount) return false;

  for (const line of refund.allocations || []) {
    const gross = money(line.gross || 0);
    if (!line.seller || gross <= 0) continue;
    await Order.updateOne(
      { _id: refund.order, "sellerFulfillments.seller": line.seller },
      { $inc: { "sellerFulfillments.$.refundedSubtotal": gross } },
    );
    await refreshPayout(refund.order, line.seller);
  }
  return true;
}

// Books one refund row, asks Paystack for it, and updates every derived state.
// Callers pass amountK in kobo, already capped to what is left on the payment.
export async function executeRefund({
  order,
  payment,
  amountK,
  kind,
  reason = "",
  allocations = [],
  scope,
  seller = null,
  returnRequest = null,
  dispute = null,
  trackOnOrder = true,
}) {
  if (amountK <= 0) return { status: "processed", alreadyRequested: true, refund: null };

  const lines = allocations.map((line) => ({
    seller: line.seller || null,
    gross: money(line.gross || 0),
  }));
  const refund = await Refund.create({
    order: order._id,
    payment: payment._id,
    paymentReference: payment.reference,
    scope: scope || (lines.length === 1 ? "package" : lines.length > 1 ? "order" : "payment"),
    kind,
    seller,
    returnRequest,
    dispute,
    amount: naira(amountK),
    allocations: lines,
    status: "pending",
    reason: String(reason || "").slice(0, 300),
  });

  // Re-count after booking: two concurrent refunds may each have passed the
  // first check. If the total now overflows, this one stands down.
  const countedK = await refundedKobo(payment.reference);
  if (countedK > kobo(payment.amount)) {
    await Refund.updateOne(
      { _id: refund._id },
      { $set: { status: "failed", failureMessage: "Superseded by a concurrent refund" } },
    );
    if (trackOnOrder) await syncOrderRefundStatus(order._id);
    throw refundError(
      "Another refund for this payment is being processed. Refresh and try again.",
      409,
    );
  }

  let providerData;
  try {
    providerData = await requestPaystackRefund({
      paymentReference: payment.reference,
      amountKobo: amountK,
      reason,
      orderId: order._id,
    });
  } catch (error) {
    await Refund.updateOne(
      { _id: refund._id },
      { $set: { status: "failed", failureMessage: String(error.message || "").slice(0, 500) } },
    );
    await syncPaymentStatus(payment._id);
    if (trackOnOrder) await syncOrderRefundStatus(order._id);
    throw error;
  }

  const providerStatus = String(providerData.status || "pending").toLowerCase();
  const processed = SUCCESSFUL.includes(providerStatus);
  refund.reference = String(
    providerData.id || providerData.reference || providerData.transaction_reference || refund._id,
  );
  refund.status = processed ? "processed" : "pending";
  if (processed) refund.processedAt = new Date();
  await refund.save();

  if (processed) await applyRefundAllocations(refund);
  await syncPaymentStatus(payment._id);
  if (trackOnOrder) await syncOrderRefundStatus(order._id);

  return { refund, status: refund.status, providerData, alreadyRequested: false };
}

// Refunds the goods in `allocations` (per seller, goods value before discount).
// includeShipping is only for whole-order cancellation: then the rest of the
// charge is returned, shipping included.
export async function refundGoods({
  orderId,
  allocations = [],
  includeShipping = false,
  kind,
  reason = "",
  returnRequest = null,
  dispute = null,
  scope,
}) {
  const order = await Order.findById(orderId);
  if (!order) throw refundError("Order not found", 404);
  if (!order.isPaid) throw refundError("Only paid orders can be refunded", 409);
  ensureSellerFulfillments(order);

  const lines = [];
  for (const line of allocations) {
    const gross = money(line.gross || 0);
    if (gross <= 0) continue;
    const fulfillment = order.sellerFulfillments.find((f) => sameId(f.seller, line.seller));
    if (!fulfillment) throw refundError("A refunded item does not belong to this order", 409);
    if (fulfillment.payoutId) {
      throw refundError(
        "That seller has already been paid for this package. Handle the refund manually.",
        409,
      );
    }
    const available = await remainingGross(order, fulfillment);
    if (gross > available + 0.005) {
      throw refundError(`Only ${available} of goods value is left to refund for that seller`, 409);
    }
    lines.push({ seller: line.seller, gross });
  }
  const totalGross = money(lines.reduce((sum, line) => sum + line.gross, 0));

  const payment = await paymentForOrder(order);
  if (!payment?.reference) {
    throw refundError(
      "No successful Paystack payment was found for this order; refund it manually",
      409,
    );
  }

  const leftK = kobo(payment.amount) - (await refundedKobo(payment.reference));
  let remainingAllGross = 0;
  for (const fulfillment of order.sellerFulfillments) {
    remainingAllGross += await remainingGross(order, fulfillment);
  }
  const coversEverything = remainingAllGross <= totalGross + 0.005;

  let amountK =
    includeShipping && coversEverything
      ? leftK
      : kobo(goodsRefundAmount(order, totalGross));
  amountK = Math.min(amountK, leftK);
  if (amountK <= 0) throw refundError("Nothing is left to refund on this order", 409);

  const result = await executeRefund({
    order,
    payment,
    amountK,
    kind,
    reason,
    allocations: lines,
    scope: scope || (lines.length === 1 ? "package" : "order"),
    seller: lines.length === 1 ? lines[0].seller : null,
    returnRequest,
    dispute,
    trackOnOrder: true,
  });
  return {
    ...result,
    order: await Order.findById(orderId),
    payment: await Payment.findById(payment._id),
  };
}

// Refunds whatever is still owed on a payment. For a whole-order cancellation
// (trackOnOrder) that is every remaining goods value plus shipping. For a
// charge that was never the order's own payment (trackOnOrder false) it is
// the full unrefunded amount, and the order is left alone.
export async function refundRemainder({
  orderId,
  reason = "",
  kind = "order-cancel",
  payment: suppliedPayment = null,
  trackOnOrder = true,
}) {
  const order = await Order.findById(orderId);
  if (!order) throw refundError("Order not found", 404);
  ensureSellerFulfillments(order);

  const payment = suppliedPayment || (await paymentForOrder(order));
  if (!payment?.reference) {
    throw refundError(
      "No successful Paystack payment was found for this order; refund it manually before cancelling",
      409,
    );
  }

  // Refunds made before the ledger existed have no Refund rows. Trust the
  // payment status for those instead of refunding a second time.
  const rowCount = await Refund.countDocuments({ paymentReference: payment.reference });
  if (rowCount === 0 && ["refunded", "refund_pending"].includes(payment.status)) {
    return {
      order,
      payment,
      status: payment.status === "refunded" ? "processed" : "pending",
      alreadyRequested: true,
    };
  }

  const leftK = kobo(payment.amount) - (await refundedKobo(payment.reference));
  if (leftK <= 0) {
    return { order, payment, status: "processed", alreadyRequested: true };
  }

  let allocations = [];
  if (trackOnOrder) {
    for (const fulfillment of order.sellerFulfillments) {
      const gross = await remainingGross(order, fulfillment);
      if (gross <= 0) continue;
      if (fulfillment.payoutId) {
        throw refundError(
          "A package in this order has already been paid to its seller. Handle the refund manually.",
          409,
        );
      }
      allocations.push({ seller: fulfillment.seller, gross });
    }
  }

  const result = await executeRefund({
    order,
    payment,
    amountK: leftK,
    kind: trackOnOrder ? kind : "charge-mismatch",
    reason,
    allocations,
    scope: trackOnOrder ? "order" : "payment",
    trackOnOrder,
  });
  return {
    ...result,
    order: await Order.findById(orderId),
    payment: await Payment.findById(payment._id),
  };
}

// Returns: refunds the goods on the request's lines, one refund per seller.
// Sellers already refunded for this return are skipped, so a retry after a
// failed Paystack call only pays the missing sellers.
export async function refundReturnRequest(request, { reason = "" } = {}) {
  const order = await Order.findById(request.order);
  if (!order) throw refundError("The linked order no longer exists", 409);
  if (!order.isPaid || order.status === "cancelled") {
    throw refundError("Only paid orders can be refunded from a return", 409);
  }

  const bySeller = new Map();
  for (const item of request.items || []) {
    if (!item.seller) {
      throw refundError(
        "This return has a line with no seller (legacy order). Refund it manually.",
        409,
      );
    }
    const key = String(item.seller);
    const entry = bySeller.get(key) || { seller: item.seller, gross: 0 };
    entry.gross = money(entry.gross + Number(item.price || 0) * Number(item.quantity || 0));
    bySeller.set(key, entry);
  }

  const done = new Set(
    (await Refund.find({
      returnRequest: request._id,
      status: { $in: ["pending", "processed"] },
    })
      .select("seller")
      .lean()).map((r) => String(r.seller)),
  );

  const refunds = [];
  for (const entry of bySeller.values()) {
    if (done.has(String(entry.seller))) continue;
    const result = await refundGoods({
      orderId: order._id,
      allocations: [entry],
      includeShipping: false,
      kind: "return",
      returnRequest: request._id,
      reason: reason || `Return ${request._id}`,
    });
    refunds.push(result);
  }
  return { refunds, order: await Order.findById(order._id) };
}

// Upheld "not received" report: the seller's remaining goods for that package
// are refunded. Returns null when nothing is left to refund.
export async function refundDisputedPackage(dispute) {
  const order = await Order.findById(dispute.order);
  if (!order) throw refundError("The linked order no longer exists", 409);
  ensureSellerFulfillments(order);
  const fulfillment = order.sellerFulfillments.find((f) => sameId(f.seller, dispute.seller));
  if (!fulfillment) throw refundError("That package is not part of this order", 409);
  const gross = await remainingGross(order, fulfillment);
  if (gross <= 0) return null;
  return refundGoods({
    orderId: order._id,
    allocations: [{ seller: dispute.seller, gross }],
    includeShipping: false,
    kind: "dispute",
    dispute: dispute._id,
    reason: "Report upheld: package not received",
  });
}

// Paystack told us (webhook or reconciliation) how a refund is doing.
export async function applyProviderRefundStatus(refund, data = {}) {
  const providerStatus = String(data.status || "").toLowerCase();
  if (SUCCESSFUL.includes(providerStatus)) {
    if (refund.status !== "processed") {
      refund.status = "processed";
      refund.processedAt = data.processed_at ? new Date(data.processed_at) : new Date();
      await refund.save();
    }
    await applyRefundAllocations(refund);
  } else if (providerStatus === "failed") {
    if (refund.status === "pending") {
      refund.status = "failed";
      refund.failureMessage = String(data.message || "Refund failed at Paystack").slice(0, 500);
      await refund.save();
    }
  }
  if (refund.payment) await syncPaymentStatus(refund.payment);
  if (refund.kind !== "charge-mismatch") await syncOrderRefundStatus(refund.order);
  return refund;
}

// Finds the Refund row a Paystack refund event is about.
export async function findRefundByProviderData(data = {}) {
  const ids = [data.id, data.reference, data.refund_reference]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String);
  if (!ids.length) return null;
  return Refund.findOne({ reference: { $in: ids } });
}

export async function hasRefundRows(paymentReference) {
  return Boolean(await Refund.exists({ paymentReference }));
}
