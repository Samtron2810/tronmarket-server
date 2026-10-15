import crypto from "crypto";
import paystackApi from "../config/paystack.js";
import getAllowedOrigins from "../config/allowedOrigins.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import { sendOrderReceiptEmail } from "../emails/emailService.js";
import { notifySellersOrderPaid } from "../services/orderNotificationService.js";
import {
  PAYMENT_CURRENCY,
  applyRefundWebhook,
  claimPaymentRecord,
  expectedAmountKobo,
  finalizeSuccessfulPayment,
  flagPaymentForRefund,
  isPaymentAfterDeadline,
  validateSuccessfulTransaction,
} from "../services/paymentService.js";
import {
  expireOrderIfDue,
  isOrderExpired,
} from "../services/orderExpiryService.js";

function sendGatewayError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res
      .status(error.statusCode)
      .json({ success: false, message: error.message });
  }
  if (error?.response) {
    return res.status(error.response.status || 502).json({
      success: false,
      message: error.response.data?.message || "Paystack gateway error",
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

// The hosted Paystack page must send the buyer back to our checkout, but
// only ever to an origin we already trust for CORS.
function resolveCallbackUrl(requestedCallbackUrl) {
  const allowedOrigins = getAllowedOrigins();

  if (requestedCallbackUrl) {
    try {
      const url = new URL(requestedCallbackUrl);
      const origin = `${url.protocol}//${url.host}`;
      if (allowedOrigins.includes(origin) && url.pathname === "/checkout") {
        return `${origin}/checkout`;
      }
    } catch {
      // fall through to the configured default below
    }
  }

  const fallback = process.env.CLIENT_URL || allowedOrigins[0] || "http://localhost:5173";
  try {
    const url = new URL(fallback);
    return `${url.protocol}//${url.host}/checkout`;
  } catch {
    return "http://localhost:5173/checkout";
  }
}

function metadataOrderId(data) {
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

// POST /api/payments/initialize — the server, never the browser, decides
// the amount, currency, reference and order binding for a charge. The
// Payment row is written before Paystack is called, so the resulting
// reference can only ever pay for this order (C1/C2).
export const initializePayment = async (req, res) => {
  let payment = null;
  try {
    const { orderId, callbackUrl } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (order.isPaid) {
      return res.status(409).json({ message: "Order has already been paid" });
    }
    if (order.status !== "pending") {
      return res.status(409).json({
        message: `Order is ${order.status} and can no longer accept payment`,
      });
    }

    // Past the payment deadline the reserved stock goes back — expire the
    // order on the spot instead of starting a charge that can't be used.
    if (isOrderExpired(order)) {
      const { order: expiredOrder } = await expireOrderIfDue(order);
      return res.status(410).json({
        success: false,
        message:
          "This order's payment window has expired. Please place a new order.",
        order: expiredOrder,
      });
    }

    const amountKobo = expectedAmountKobo(order);
    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      return res
        .status(400)
        .json({ message: "Order total must be greater than zero" });
    }

    const existingSuccess = await Payment.findOne({
      order: order._id,
      status: "success",
    });
    if (existingSuccess) {
      return res.status(409).json({
        message:
          "A successful payment already exists for this order; please contact support instead of paying again",
      });
    }

    const reference = `TRON-${order._id}-${Date.now()}-${crypto
      .randomBytes(6)
      .toString("hex")}`;

    payment = await Payment.create({
      order: order._id,
      user: req.user._id,
      amount: order.totalPrice,
      currency: PAYMENT_CURRENCY,
      reference,
      status: "pending",
    });

    const paystackRes = await paystackApi.post("/transaction/initialize", {
      email: req.user.email,
      amount: amountKobo,
      currency: PAYMENT_CURRENCY,
      reference,
      callback_url: resolveCallbackUrl(callbackUrl),
      metadata: {
        orderId: order._id.toString(),
        custom_fields: [],
      },
    });

    const data = paystackRes.data?.data;
    if (!paystackRes.data?.status || !data?.authorization_url) {
      payment.status = "failed";
      await payment.save();
      return res.status(502).json({
        success: false,
        message: paystackRes.data?.message || "Could not initialize payment",
      });
    }
    if (data.reference && data.reference !== reference) {
      payment.status = "failed";
      await payment.save();
      return res.status(502).json({
        success: false,
        message: "Paystack returned an unexpected payment reference",
      });
    }

    return res.status(201).json({
      success: true,
      reference,
      authorization_url: data.authorization_url,
      amount: amountKobo,
      currency: PAYMENT_CURRENCY,
      email: req.user.email,
    });
  } catch (error) {
    if (payment && payment.status === "pending") {
      payment.status = "failed";
      await payment.save().catch(() => {});
    }
    return sendGatewayError(res, error, "Failed to initialize payment.");
  }
};

// POST /api/payments/verify — a charge only pays for an order when the
// amount, currency, order binding and customer all match exactly, and the
// order is still pending (C1/C2/C4). Anything else leaves the order unpaid
// and routes the real charge to refund.
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    let { orderId } = req.body;

    const boundPayment = await Payment.findOne({ reference });
    if (!orderId && boundPayment) orderId = boundPayment.order.toString();
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required for this payment reference",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (
      boundPayment &&
      (boundPayment.order.toString() !== order._id.toString() ||
        boundPayment.user.toString() !== req.user._id.toString())
    ) {
      return res.status(409).json({
        success: false,
        message: "This payment reference has already been used for another order",
      });
    }

    if (
      order.isPaid &&
      order.status !== "cancelled" &&
      order.paymentReference === reference
    ) {
      return res.json({ success: true, message: "Order already paid", order });
    }

    const paystackRes = await paystackApi.get(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    const data = paystackRes.data?.data;
    if (!paystackRes.data?.status || !data) {
      return res.status(502).json({
        success: false,
        message: "Paystack returned no transaction data",
      });
    }

    let payment = boundPayment;

    if (data.status !== "success") {
      if (payment) {
        payment.status = "failed";
        await payment.save();
      }
      return res.status(400).json({
        success: false,
        message: `Payment was not successful: ${data.gateway_response || data.status}`,
      });
    }

    const validationError = validateSuccessfulTransaction(
      data,
      order,
      reference,
      req.user.email,
    );
    if (validationError) {
      // Only bind (and refund) the charge here when it is already bound to
      // this order, or its own metadata names this order. A reference that
      // belongs to a different order must stay usable by that order.
      if (
        !payment &&
        String(metadataOrderId(data) || "") === order._id.toString()
      ) {
        payment = await claimPaymentRecord({
          reference,
          order,
          userId: req.user._id,
        });
      }
      if (!payment) {
        return res.status(400).json({
          success: false,
          message: `Payment could not be applied to this order: ${validationError}.`,
        });
      }
      const flagged = await flagPaymentForRefund({
        order,
        payment,
        data,
        reason: validationError,
      });
      return res.status(400).json({
        success: false,
        message: `Payment could not be applied to this order: ${validationError}.${
          flagged.refundInitiated
            ? " A refund has been requested."
            : " Please contact support for a refund."
        }`,
      });
    }

    if (!payment) {
      payment = await claimPaymentRecord({
        reference,
        order,
        userId: req.user._id,
      });
    }

    if (!order.isPaid && isPaymentAfterDeadline(order, data)) {
      const flagged = await flagPaymentForRefund({
        order,
        payment,
        data,
        reason: "Payment completed after the order payment deadline",
      });
      return res.status(409).json({
        success: false,
        message: `Payment was completed after this order's payment deadline.${
          flagged.refundInitiated
            ? " A refund has been requested."
            : " Please contact support for a refund."
        }`,
        refundInitiated: flagged.refundInitiated,
      });
    }

    if (order.isPaid || order.status !== "pending") {
      const flagged = await flagPaymentForRefund({
        order,
        payment,
        data,
        reason: order.isPaid
          ? "Duplicate payment for an already paid order"
          : `Payment received for a ${order.status} order`,
      });
      return res.status(409).json({
        success: false,
        message: order.isPaid
          ? "This order has already been paid with a different payment reference"
          : `Order is ${order.status} and can no longer accept payment`,
        refundInitiated: flagged.refundInitiated,
      });
    }

    const { order: paidOrder, transitioned } =
      await finalizeSuccessfulPayment({
        order,
        payment,
        reference,
        data,
        source: "verify",
      });

    // Fire-and-forget receipt email — only for the request that actually
    // transitioned the order, so verify/webhook races can't double-send.
    if (transitioned && req.user.email) {
      sendOrderReceiptEmail(
        req.user.email,
        req.user.name,
        paidOrder.toObject(),
      );
      void notifySellersOrderPaid(paidOrder);
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      order: paidOrder,
    });
  } catch (error) {
    return sendGatewayError(res, error, "Failed to verify payment.");
  }
};

export const paystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.sendStatus(500);

    const hash = crypto
      .createHmac("sha512", secret)
      .update(req.rawBody || JSON.stringify(req.body || {}))
      .digest("hex");

    const expected = Buffer.from(hash, "hex");
    const provided = Buffer.from(
      String(req.headers["x-paystack-signature"] || ""),
      "hex",
    );
    if (
      expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      return res.status(401).json({ message: "Invalid signature" });
    }

    const event = req.body;

    if (typeof event?.event === "string" && event.event.startsWith("refund.")) {
      await applyRefundWebhook(event.data || {});
      return res.sendStatus(200);
    }

    if (event?.event === "charge.success") {
      const data = event.data || {};
      const { reference } = data;
      if (!reference) return res.sendStatus(200);

      const boundPayment = await Payment.findOne({ reference });
      const claimedOrderId = metadataOrderId(data);
      if (
        boundPayment &&
        claimedOrderId &&
        boundPayment.order.toString() !== String(claimedOrderId)
      ) {
        console.warn(
          `Paystack webhook: reference ${reference} is bound to order ${boundPayment.order} but claims ${claimedOrderId}; ignoring`,
        );
        return res.sendStatus(200);
      }

      const orderId = boundPayment?.order || claimedOrderId;
      if (!orderId) return res.sendStatus(200);

      const order = await Order.findById(orderId);
      if (!order) return res.sendStatus(200);

      const buyer = await User.findById(order.user).select("name email").lean();

      const payment = await claimPaymentRecord({
        reference,
        order,
        userId: order.user,
      });

      if (data.status !== "success") {
        payment.status = "failed";
        await payment.save();
        return res.sendStatus(200);
      }

      const validationError = validateSuccessfulTransaction(
        data,
        order,
        reference,
        buyer?.email,
      );
      if (validationError) {
        await flagPaymentForRefund({
          order,
          payment,
          data,
          reason: validationError,
        });
        return res.sendStatus(200);
      }

      if (!order.isPaid && isPaymentAfterDeadline(order, data)) {
        await flagPaymentForRefund({
          order,
          payment,
          data,
          reason: "Payment completed after the order payment deadline",
        });
        return res.sendStatus(200);
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
        return res.sendStatus(200);
      }

      const { order: paidOrder, transitioned } =
        await finalizeSuccessfulPayment({
          order,
          payment,
          reference,
          data,
          source: "webhook",
        });

      if (transitioned && buyer?.email) {
        sendOrderReceiptEmail(buyer.email, buyer.name, paidOrder.toObject());
        void notifySellersOrderPaid(paidOrder);
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("paystackWebhook:", error);
    return res.sendStatus(500);
  }
};
