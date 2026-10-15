import { getResend } from "../config/resend.js";
import { otpEmailHtml } from "./templates/otpEmail.js";
import { passwordResetEmailHtml } from "./templates/passwordResetEmail.js";
import { orderReceiptHtml } from "./templates/orderReceiptEmail.js";

const FROM_ADDRESS =
  process.env.EMAIL_FROM || "TronMarket <onboarding@resend.dev>";

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

export async function sendPasswordResetEmail(toEmail, name, otp) {
  const resend = getResend();
  if (!resend) {
    console.warn(
      "sendPasswordResetEmail skipped: RESEND_API_KEY not configured.",
    );
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: toEmail,
      subject: "Reset your TronMarket password",
      html: passwordResetEmailHtml(name, otp),
    });

    if (error) {
      console.error(
        "Resend API returned an error during sendPasswordResetEmail:",
        error,
      );
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error("sendPasswordResetEmail exception:", err?.message || err);
    return { success: false, error: err?.message || err };
  }
}

export async function sendEmailSafe({ to, subject, html } = {}) {
  if (!to || !subject || !html) return { success: false };
  const resend = getResend();
  if (!resend) {
    console.warn("sendEmailSafe skipped: RESEND_API_KEY not configured.");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    if (error) {
      console.error("Resend API returned an error during sendEmailSafe:", error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    console.error("sendEmailSafe exception:", err?.message || err);
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

export function sendAbandonedCartEmail(toEmail, name, itemCount) {
  const storeUrl = process.env.PUBLIC_STORE_URL || process.env.FRONTEND_URL || "";
  const cartUrl = storeUrl ? `${storeUrl.replace(/\/$/, "")}/cart` : "/cart";
  return sendEmailSafe({
    to: toEmail,
    subject: "You left something in your cart",
    html: `<div style="font-family:Arial,sans-serif;color:#111827">
      <h2>Hi ${String(name || "there")},</h2>
      <p>You still have ${itemCount} item${itemCount === 1 ? "" : "s"} in your TronMarket cart. They are selling fast, so complete your order before they are gone.</p>
      <p><a href="${cartUrl}" style="color:#047857">Return to your cart</a></p>
      <p>The TronMarket team</p>
    </div>`,
  });
}

export function sendPaymentReminderEmail(toEmail, name, orderId, minutesLeft) {
  const storeUrl = process.env.PUBLIC_STORE_URL || process.env.FRONTEND_URL || "";
  const ordersUrl = storeUrl ? `${storeUrl.replace(/\/$/, "")}/my-orders` : "/my-orders";
  return sendEmailSafe({
    to: toEmail,
    subject: "Complete your TronMarket payment",
    html: `<div style="font-family:Arial,sans-serif;color:#111827">
      <h2>Hi ${String(name || "there")},</h2>
      <p>Your order <strong>${String(orderId)}</strong> is still waiting for payment${minutesLeft > 0 ? ` — about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} left before the reservation expires` : ""}.</p>
      <p><a href="${ordersUrl}" style="color:#047857">Complete payment from My Orders</a></p>
      <p>The TronMarket team</p>
    </div>`,
  });
}
