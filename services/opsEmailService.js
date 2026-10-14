import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import { sendAbandonedCartEmail, sendPaymentReminderEmail } from "../emails/emailService.js";

// Recovery emails run on an interval from server.js. Guards:
//  - one abandoned-cart reminder per cart, ~2h after last activity
//  - one payment reminder per unpaid order, ~10min after creation

const CART_REMINDER_AFTER_MS = 2 * 60 * 60 * 1000;
const ORDER_REMINDER_AFTER_MS = 10 * 60 * 1000;

export async function sendRecoveryEmails() {
  const stats = { carts: 0, orders: 0 };
  try {
    const carts = await Cart.find({
      lastAbandonedReminderAt: null,
      updatedAt: { $lt: new Date(Date.now() - CART_REMINDER_AFTER_MS) },
      "items.0": { $exists: true },
    }).populate("user", "name email").limit(25).lean();

    for (const cart of carts) {
      if (cart.user?.email) {
        sendAbandonedCartEmail(cart.user.email, cart.user.name, cart.items?.length || 0);
        stats.carts += 1;
      }
      await Cart.updateOne({ _id: cart._id }, { $set: { lastAbandonedReminderAt: new Date() } });
    }
  } catch (error) {
    console.error("Abandoned-cart reminders failed:", error?.message || error);
  }

  try {
    const orders = await Order.find({
      status: "pending",
      paymentStatus: "unpaid",
      paymentReminderSentAt: null,
      createdAt: { $lt: new Date(Date.now() - ORDER_REMINDER_AFTER_MS) },
    }).limit(25).lean();

    for (const order of orders) {
      if (order.email) {
        const minutesLeft = order.paymentExpiresAt
          ? Math.max(0, Math.round((new Date(order.paymentExpiresAt).getTime() - Date.now()) / 60000))
          : 0;
        sendPaymentReminderEmail(order.email, order.name, order._id, minutesLeft);
        stats.orders += 1;
      }
      await Order.updateOne({ _id: order._id }, { $set: { paymentReminderSentAt: new Date() } });
    }
  } catch (error) {
    console.error("Payment reminders failed:", error?.message || error);
  }
  return stats;
}

let timer = null;
export function startRecoveryEmailJob() {
  if (timer) return;
  timer = setInterval(() => {
    sendRecoveryEmails().catch(() => {});
  }, 5 * 60 * 1000);
  timer.unref?.();
}
