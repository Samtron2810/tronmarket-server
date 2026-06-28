import crypto from "crypto";
import paystackApi from "../config/paystack.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";

export const verifyPayment = async (req, res) => {
  try {
    const { reference, orderId } = req.body;

    if (!reference || !orderId) {
      return res
        .status(400)
        .json({ message: "reference and orderId are required" });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (order.isPaid) {
      return res.json({ success: true, message: "Order already paid", order });
    }

    const paystackRes = await paystackApi.get(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );

    const data = paystackRes.data.data;

    let payment = await Payment.findOne({ reference });

    if (!payment) {
      payment = new Payment({
        order: order._id,
        user: req.user._id,
        amount: order.totalPrice,
        reference,
      });
    }

    if (paystackRes.data.status && data.status === "success") {
      payment.status = "success";
      payment.paidAt = new Date();
      await payment.save();

      order.isPaid = true;
      order.paidAt = new Date();
      order.status = "paid";
      order.paymentReference = reference;
      order.statusHistory.push({
        status: "paid",
        note: "Payment confirmed via Paystack",
      });
      await order.save();

      return res.status(200).json({
        success: true,
        message: "Payment verified successfully",
        order,
      });
    } else {
      payment.status = "failed";
      await payment.save();

      return res.status(400).json({
        success: false,
        message: `Payment verification failed: ${
          data?.gateway_response || "Unknown error"
        }`,
      });
    }
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        message: error.response.data?.message || "Paystack gateway error",
      });
    }

    console.error("verifyPayment:", error);
    res.status(500).json({ message: "Failed to verify payment." });
  }
};

export const paystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;

    const hash = crypto
      .createHmac("sha512", secret)
      .update(req.rawBody)
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).json({ message: "Invalid signature" });
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const { reference, metadata } = event.data;

      let payment = await Payment.findOne({ reference });

      const orderId = payment?.order || metadata?.orderId;

      if (!orderId) return res.sendStatus(200);

      const order = await Order.findById(orderId);

      if (!payment) {
        payment = new Payment({
          order: orderId,
          user: order?.user,
          amount: order?.totalPrice || 0,
          reference,
        });
      }

      if (payment.status !== "success") {
        payment.status = "success";
        payment.paidAt = new Date();
        await payment.save();
      }

      if (order && !order.isPaid) {
        order.isPaid = true;
        order.paidAt = new Date();
        order.status = "paid";
        order.paymentReference = reference;
        order.statusHistory.push({
          status: "paid",
          note: "Payment confirmed via Paystack webhook",
        });
        await order.save();
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("paystackWebhook:", error);
    res.sendStatus(500);
  }
};
