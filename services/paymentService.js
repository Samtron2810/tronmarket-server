import paystackApi from "../config/paystack.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";

// ─── Shared Paystack payment rules ──────────────────────────────────────────
// Both the browser verification endpoint and the Paystack webhook must make
// exactly the same decision about whether a charge pays for an order. Keeping
// that decision here prevents the two paths drifting apart:
//
//   * the Paystack reference must be bound to one order and one user only;
//   * the charged amount (in kobo) and currency must equal the order total;
//   * the transaction metadata must name that same order;
//   * the charge must have been made by the order owner's email;
//   * only a still-"pending" order can become "paid" — a cancelled order
//     can never be flipped back to paid by a late payment.

export const PAYMENT_CURRENCY = "NGN";

export function paymentError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Paystack charges in kobo; order totals are stored in Naira.
export function expectedAmountKobo(order) {
  return Math.round(Number(order?.totalPrice || 0) * 100);
}

function metadataOf(data) {
  if (!data?.metadata) return {};
  if (typeof data.metadata === "string") {
    try {
      return JSON.parse(data.metadata);
    } catch {
      return {};
    }
  }
  return data.metadata;
}

// Returns a human-readable rejection reason, or null when the Paystack
// transaction is an exact, successful payment for this order.
export function validateSuccessfulTransaction(data, order, reference, expectedEmail) {
  if (!data) return "Paystack returned no transaction data";
  if (data.status !== "success") {
    return `Payment was not successful: ${data.gateway_response || data.status || "unknown status"}`;
  }
  if (String(data.reference || "") !== String(reference || "")) {
    return "Payment reference does not match the verified transaction";
  }
  if (Number(data.amount) !== expectedAmountKobo(order)) {
    return "Payment amount does not match the order total";
  }
  if (String(data.currency || PAYMENT_CURRENCY).toUpperCase() !== PAYMENT_CURRENCY) {
    return "Payment currency does not match the order currency";
  }

  const metadata = metadataOf(data);
  const metadataOrderId = metadata.orderId || metadata.order_id;
  if (!metadataOrderId || String(metadataOrderId) !== String(order._id)) {
    return "Payment is not bound to this order";
  }

  const customerEmail = data.customer?.email || data.email;
  if (
    expectedEmail &&
    customerEmail &&
    String(customerEmail).toLowerCase() !== String(expectedEmail).toLowerCase()
  ) {
    return "Payment was made with a different email address";
  }

  return null;
}

// Find the Payment row for a reference, creating the binding on first use.
// The unique index on Payment.reference plus this ownership check is what
// stops one successful reference being replayed against a second order.
export async function claimPaymentRecord({ reference, order, userId }) {
  let payment = await Payment.findOne({ reference });

  if (!payment) {
    try {
      payment = await Payment.create({
        order: order._id,
        user: userId,
        amount: order.totalPrice,
        currency: PAYMENT_CURRENCY,
        reference,
        status: "pending",
      });
    } catch (error) {
      // Lost a race with a parallel request creating the same reference.
      if (error?.code !== 11000) throw error;
      payment = await Payment.findOne({ reference });
    }
  }

  if (!payment) {
    throw paymentError("Could not record this payment reference", 500);
  }

  if (
    String(payment.order) !== String(order._id) ||
    String(payment.user) !== String(userId)
  ) {
    throw paymentError(
      "This payment reference has already been used for another order",
      409,
    );
  }

  return payment;
}

export function paymentCompletedAt(data) {
  const value = data?.paid_at || data?.paidAt;
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function paymentDeadlineForOrder(order) {
  if (!order) return null;
  if (order.paymentExpiresAt) return new Date(order.paymentExpiresAt);
  if (!order.createdAt) return null;
  const minutes = Number(process.env.ORDER_PAYMENT_TTL_MINUTES || 30);
  const safeMinutes = Number.isFinite(minutes)
    ? Math.min(24 * 60, Math.max(5, minutes))
    : 30;
  return new Date(
    new Date(order.createdAt).getTime() + safeMinutes * 60 * 1000,
  );
}

// True when Paystack's own paid_at timestamp falls after the order's
// payment deadline (stored, or derived from createdAt for legacy orders).
// Verification may legitimately happen after the deadline — what matters
// is when the charge itself completed.
export function isPaymentAfterDeadline(order, data) {
  if (!order || order.isPaid) return false;
  const deadline = paymentDeadlineForOrder(order);
  return Boolean(deadline && paymentCompletedAt(data) > deadline);
}

// Atomically move pending → paid. The status filter in the query is the
// actual guard: cancelled / shipped / already-paid orders cannot match it.
// The payment deadline is enforced here too: a charge only counts when
// Paystack says it was paid on or before the order's payment deadline
// (stored on the order, or derived from createdAt for legacy orders).
export async function transitionOrderToPaid(order, reference, source, paidAtInput) {
  const paidAt = paidAtInput ? new Date(paidAtInput) : new Date();
  if (isPaymentAfterDeadline(order, { paid_at: paidAt })) {
    throw paymentError(
      "Payment was completed after this order's payment deadline",
      409,
    );
  }
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: "pending",
      isPaid: false,
      $or: [
        { paymentExpiresAt: null },
        { paymentExpiresAt: { $exists: false } },
        { paymentExpiresAt: { $gte: paidAt } },
      ],
    },
    {
      $set: {
        isPaid: true,
        paidAt,
        status: "paid",
        paymentReference: reference,
      },
      $push: {
        statusHistory: {
          status: "paid",
          note:
            source === "webhook"
              ? "Payment confirmed via Paystack webhook"
              : "Payment confirmed via Paystack",
        },
      },
    },
    { new: true },
  );

  if (updated) return { order: updated, transitioned: true };

  const current = await Order.findById(order._id);
  if (current?.isPaid && current.paymentReference === reference) {
    // Idempotent retry (browser verify + webhook racing) — not an error.
    return { order: current, transitioned: false };
  }

  throw paymentError(
    current?.isPaid
      ? "This order has already been paid with a different payment reference"
      : `Order is ${current?.status || "not found"} and can no longer accept payment`,
    409,
  );
}

export async function finalizeSuccessfulPayment({
  order,
  payment,
  reference,
  data,
  source,
}) {
  const { order: paidOrder, transitioned } = await transitionOrderToPaid(
    order,
    reference,
    source,
    data?.paid_at || data?.paidAt,
  );

  payment.status = "success";
  payment.amount = Number(data.amount) / 100;
  payment.currency = String(data.currency || PAYMENT_CURRENCY).toUpperCase();
  payment.paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
  await payment.save();

  return { order: paidOrder, payment, transitioned };
}

// Ask Paystack to refund the successful charge behind an order. Used both
// when a paid order is cancelled and when a real charge arrives that can no
// longer be applied (cancelled order, wrong amount, duplicate payment).
// Never changes order status or stock — callers own those decisions.
export async function initiateRefundForOrder(
  orderInput,
  {
    reason = "Order cancelled",
    payment: suppliedPayment = null,
    // When given, the refund claim only succeeds while the order is still in
    // one of these statuses — a concurrent status change (e.g. the order was
    // shipped in the meantime) aborts before Paystack is called.
    expectedStatuses = null,
    // Refunds for charges that were never the order's payment (wrong
    // amount, duplicate second payment) are tracked on the Payment row
    // only, so the order's own refund state stays clean for a later,
    // legitimate payment or cancellation.
    trackOnOrder = true,
  } = {},
) {
  let order = await Order.findById(orderInput?._id || orderInput);
  if (!order) throw paymentError("Order not found", 404);

  if (trackOnOrder && order.refundStatus === "processed") {
    const payment =
      suppliedPayment ||
      (await Payment.findOne({ order: order._id }).sort({ createdAt: -1 }));
    if (payment && payment.status !== "refunded") {
      payment.status = "refunded";
      payment.refundReference = order.refundReference || payment.refundReference;
      await payment.save();
    }
    return { order, payment, status: "processed", alreadyRequested: true };
  }

  // A previous attempt already reached Paystack; don't refund twice.
  if (trackOnOrder && order.refundStatus === "pending" && order.refundReference) {
    const payment =
      suppliedPayment ||
      (await Payment.findOne({ order: order._id }).sort({ createdAt: -1 }));
    if (payment && payment.status !== "refunded") {
      payment.status = "refund_pending";
      payment.refundReference = order.refundReference || payment.refundReference;
      await payment.save();
    }
    return { order, payment, status: "pending", alreadyRequested: true };
  }

  // Claim the refund attempt so parallel cancel requests can't both call
  // Paystack for the same order.
  if (trackOnOrder && order.refundStatus !== "pending") {
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        // null also matches orders saved before refundStatus existed.
        refundStatus: { $in: ["none", "failed", null] },
        ...(expectedStatuses ? { status: { $in: expectedStatuses } } : {}),
      },
      { $set: { refundStatus: "pending" } },
      { new: true },
    );
    if (!claimed) {
      const current = await Order.findById(order._id);
      if (current?.refundStatus === "processed") {
        return { order: current, payment: suppliedPayment, status: "processed", alreadyRequested: true };
      }
      throw paymentError("A refund is already being processed for this order", 409);
    }
    order = claimed;
  }

  let payment = suppliedPayment;
  if (!payment && order.paymentReference) {
    payment = await Payment.findOne({ reference: order.paymentReference });
  }
  if (!payment) {
    payment = await Payment.findOne({
      order: order._id,
      status: { $in: ["success", "requires_refund", "refund_failed"] },
    }).sort({ createdAt: -1 });
  }
  if (!payment && order.paymentReference) {
    // Paid orders created before Payment rows existed still carry their
    // Paystack reference on the order — recreate the binding so they can
    // be refunded instead of being stranded.
    try {
      payment = await Payment.create({
        order: order._id,
        user: order.user,
        amount: order.totalPrice,
        currency: PAYMENT_CURRENCY,
        reference: order.paymentReference,
        status: "success",
        paidAt: order.paidAt || new Date(),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      payment = await Payment.findOne({ reference: order.paymentReference });
    }
  }

  if (!payment?.reference) {
    if (trackOnOrder) {
      await Order.updateOne(
        { _id: order._id, refundStatus: "pending" },
        { $set: { refundStatus: "failed" } },
      );
    }
    throw paymentError(
      "No successful Paystack payment was found for this order; refund it manually before cancelling",
      409,
    );
  }

  // Refund what was actually charged (for a verified payment that equals
  // the order total; for a mismatched charge it is the smaller real amount).
  const amountKobo =
    Math.round(Number(payment.amount || 0) * 100) || expectedAmountKobo(order);
  let refundData;
  try {
    const response = await paystackApi.post("/refund", {
      transaction: payment.reference,
      amount: amountKobo,
      currency: PAYMENT_CURRENCY,
      customer_note: reason,
      merchant_note: `TronMarket refund for order ${order._id}`,
    });
    if (!response.data?.status || !response.data?.data) {
      throw new Error(response.data?.message || "Paystack rejected the refund");
    }
    refundData = response.data.data;
  } catch (error) {
    if (trackOnOrder) {
      await Order.updateOne(
        { _id: order._id },
        { $set: { refundStatus: "failed" } },
      );
    }
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { status: "refund_failed" } },
    );
    throw paymentError(
      error.response?.data?.message ||
        error.message ||
        "Paystack refund request failed",
      502,
    );
  }

  const providerStatus = String(refundData.status || "pending").toLowerCase();
  const processed = ["processed", "success", "succeeded"].includes(providerStatus);
  const refundReference = String(
    refundData.reference ||
      refundData.transaction_reference ||
      refundData.id ||
      payment.reference,
  );

  const updatedOrder = trackOnOrder
    ? await Order.findByIdAndUpdate(
        order._id,
        {
          $set: {
            refundStatus: processed ? "processed" : "pending",
            refundReference,
            refundAmount: amountKobo / 100,
            ...(processed ? { refundedAt: new Date() } : {}),
          },
        },
        { new: true },
      )
    : order;

  payment.status = processed ? "refunded" : "refund_pending";
  payment.refundReference = refundReference;
  await payment.save();

  return {
    order: updatedOrder,
    payment,
    refund: refundData,
    status: processed ? "processed" : "pending",
    alreadyRequested: false,
  };
}

// A charge succeeded at Paystack but cannot pay for its order (cancelled
// order, amount mismatch, second payment for a paid order...). Record it and
// try to send the money straight back; the order itself is never touched.
export async function flagPaymentForRefund({ order, payment, data, reason }) {
  payment.status = "requires_refund";
  if (Number.isFinite(Number(data?.amount))) {
    payment.amount = Number(data.amount) / 100;
  }
  payment.currency = String(data?.currency || PAYMENT_CURRENCY).toUpperCase();
  payment.paidAt = data?.paid_at ? new Date(data.paid_at) : new Date();
  await payment.save();

  try {
    const trackOnOrder =
      order.status === "cancelled" ||
      String(order.paymentReference || "") === String(payment.reference);
    const result = await initiateRefundForOrder(order, {
      reason,
      payment,
      trackOnOrder,
    });
    return { ...result, refundInitiated: true };
  } catch (error) {
    const currentPayment = await Payment.findById(payment._id);
    const currentOrder = await Order.findById(order._id);
    return {
      order: currentOrder,
      payment: currentPayment,
      refundInitiated: false,
      refundError: error,
    };
  }
}

// Paystack refund lifecycle webhooks (refund.pending / refund.processing /
// refund.processed / refund.failed) keep our refund state honest after the
// initial refund request has been accepted.
export async function applyRefundWebhook(data) {
  const transactionReference =
    data?.transaction_reference || data?.transaction?.reference || data?.reference;

  let payment = transactionReference
    ? await Payment.findOne({ reference: transactionReference })
    : null;
  if (!payment && data?.id) {
    payment = await Payment.findOne({ refundReference: String(data.id) });
  }
  if (!payment && data?.reference) {
    payment = await Payment.findOne({ refundReference: String(data.reference) });
  }
  if (!payment) return null;

  const providerStatus = String(data.status || "").toLowerCase();
  const order = await Order.findById(payment.order);
  if (!order) return null;

  // Only the order's own payment drives the order-level refund state; a
  // refunded duplicate/mismatched charge is tracked on its Payment row.
  const trackOnOrder =
    order.status === "cancelled" ||
    String(order.paymentReference || "") === String(payment.reference);

  if (["processed", "success", "succeeded"].includes(providerStatus)) {
    payment.status = "refunded";
    if (trackOnOrder) {
      order.refundStatus = "processed";
      order.refundedAt = data.processed_at ? new Date(data.processed_at) : new Date();
    }
  } else if (providerStatus === "failed") {
    payment.status = "refund_failed";
    if (trackOnOrder) order.refundStatus = "failed";
  } else {
    payment.status = "refund_pending";
    if (trackOnOrder && order.refundStatus !== "processed") {
      order.refundStatus = "pending";
    }
  }

  payment.refundReference = String(
    data.reference || data.id || payment.refundReference || "",
  );
  if (trackOnOrder) {
    order.refundReference = payment.refundReference;
    order.statusHistory.push({
      status: order.status,
      note: `Paystack refund ${providerStatus || "updated"}`,
    });
    await order.save();
  }

  await payment.save();
  return { payment, order };
}
