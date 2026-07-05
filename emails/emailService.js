import { getResend } from "../config/resend.js";
import { otpEmailHtml } from "./templates/otpEmail.js";
import { orderReceiptHtml } from "./templates/orderReceiptEmail.js";

const FROM_ADDRESS =
  process.env.EMAIL_FROM || "TronMarket <onboarding@resend.dev>";

export async function sendOtpEmail(toEmail, name, otp) {
  const resend = getResend();
  if (!resend) return;

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: toEmail,
      subject: `${otp} — Your TronMarket verification code`,
      html: otpEmailHtml(name, otp),
    });
  } catch (err) {
    console.error("sendOtpEmail failed:", err?.message || err);
  }
}

export async function sendOrderReceiptEmail(toEmail, customerName, order) {
  const resend = getResend();
  if (!resend) return;

  const shortId = order._id
    ? String(order._id).slice(-8).toUpperCase()
    : "ORDER";

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: toEmail,
      subject: `Order Confirmed #${shortId} — TronMarket Receipt`,
      html: orderReceiptHtml(order, customerName),
    });
  } catch (err) {
    console.error("sendOrderReceiptEmail failed:", err?.message || err);
  }
}
