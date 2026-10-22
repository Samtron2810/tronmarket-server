// ─── Settling a successful Paystack charge ──────────────────────────────────
// The one place a "this charge succeeded" event (Paystack webhook, or the
// reconciliation sweeper polling Paystack for a missed webhook) is turned into
// a paid order, a flagged charge, or a failed payment. The browser verify
// endpoint answers the buyer directly, so it keeps its own response handling
// but makes the same validation and flagging decisions through paymentService.
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import { sendOrderReceiptEmail } from "../emails/emailService.js";
import { notifySellersOrderPaid } from "./orderNotificationService.js";
import {
  claimPaymentRecord,
  finalizeSuccessfulPayment,
  flagPaymentForRefund,
  isPaymentAfterDeadline,
  validateSuccessfulTransaction,
} from "./paymentService.js";

export function metadataOrderId(data) {
  let metadata = data?.metadata;
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  return metadata?.orderId || metadata?.order_id || null;
}

// Returns { outcome }: "ignored" | "failed" | "flagged" | "paid" | "already-paid".
export async function settleChargeSuccess(data, { source = "webhook" } = {}) {
  const { reference } = data || {};
  if (!reference) return { outcome: "ignored" };

  const boundPayment = await Payment.findOne({ reference });
  const claimedOrderId = metadataOrderId(data);
  if (
    boundPayment &&
    claimedOrderId &&
    boundPayment.order.toString() !== String(claimedOrderId)
  ) {
    console.warn(
      `Charge ${reference} is bound to order ${boundPayment.order} but claims ${claimedOrderId}; ignoring`,
    );
    return { outcome: "ignored" };
  }

  const orderId = boundPayment?.order || claimedOrderId;
  if (!orderId) return { outcome: "ignored" };

  const order = await Order.findById(orderId);
  if (!order) return { outcome: "ignored" };

  const buyer = await User.findById(order.user).select("name email").lean();
  const payment = await claimPaymentRecord({
    reference,
    order,
    userId: order.user,
  });

  if (data.status !== "success") {
    payment.status = "failed";
    await payment.save();
    return { outcome: "failed" };
  }

  const validationError = validateSuccessfulTransaction(
    data,
    order,
    reference,
    buyer?.email,
  );
  if (validationError) {
    await flagPaymentForRefund({ order, payment, data, reason: validationError });
    return { outcome: "flagged" };
  }

  if (!order.isPaid && isPaymentAfterDeadline(order, data)) {
    await flagPaymentForRefund({
      order,
      payment,
      data,
      reason: "Payment completed after the order payment deadline",
    });
    return { outcome: "flagged" };
  }

  if (
    (order.isPaid && order.paymentReference !== reference) ||
    (!order.isPaid && order.status !== "pending")
  ) {
    await flagPaymentForRefund({
      order,
      payment,
      data,
      reason: order.isPaid
        ? "Duplicate payment for an already paid order"
        : `Payment received for a ${order.status} order`,
    });
    return { outcome: "flagged" };
  }

  const { order: paidOrder, transitioned } = await finalizeSuccessfulPayment({
    order,
    payment,
    reference,
    data,
    source,
  });

  if (transitioned && buyer?.email) {
    sendOrderReceiptEmail(buyer.email, buyer.name, paidOrder.toObject());
    void notifySellersOrderPaid(paidOrder);
  }
  return { outcome: transitioned ? "paid" : "already-paid", order: paidOrder };
}
