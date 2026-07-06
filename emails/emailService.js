import { getResend } from "../config/resend.js";
import { otpEmailHtml } from "./templates/otpEmail.js";
import { orderReceiptHtml } from "./templates/orderReceiptEmail.js";

const FROM_ADDRESS =
  process.env.EMAIL_FROM || "TronMarket <onboarding@tronmarket.com>";

export async function sendOtpEmail(toEmail, name, otp) {
  const resend = getResend();
  if (!resend) {
    console.warn("sendOtpEmail skipped: RESEND_API_KEY not configured.");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    // ✅ Destructure both data and error
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: toEmail,
      subject: `${otp} — Your TronMarket verification code`,
      html: otpEmailHtml(name, otp),
    });

    // ✅ Explicitly check if Resend returned an error object
    if (error) {
      console.error("Resend API returned an error during sendOtpEmail:", error);
      return { success: false, error };
    }

    console.log(`OTP email sent successfully to ${toEmail}. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("sendOtpEmail exception:", err?.message || err);
    return { success: false, error: err?.message || err };
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
