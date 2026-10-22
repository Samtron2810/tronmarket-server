import mongoose from "mongoose";
import User from "../models/User.js";
import {
  getSellerFulfillment,
  sellerOrderView,
} from "./orderFulfillmentService.js";
import { sendEmailSafe } from "../emails/emailService.js";
import { orderStatusEmail } from "../emails/templates/orderStatusEmail.js";

const moneyText = (value) =>
  `NGN ${Number(value || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const sellerRecipients = async (order) => {
  const ids = [
    ...new Set(
      (order.sellerFulfillments || [])
        .map((f) => f.seller?.toString())
        .filter(Boolean),
    ),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (!ids.length) return [];
  return User.find({ _id: { $in: ids }, isDeleted: { $ne: true } })
    .select("email name role")
    .lean();
};

const DELIVERY_INSTRUCTION =
  "Delivery must be initiated within 2-3 days. The product must be delivered to the buyer within a maximum of 7 days from order date. After 7 days, late delivery will start counting against your store rating.";

export async function notifySellersOrderPaid(order) {
  try {
    const sellers = await sellerRecipients(order);
    const orderDate = new Date(order.createdAt || Date.now()).toLocaleString(
      "en-NG",
      { dateStyle: "medium", timeStyle: "short" },
    );
    await Promise.all(
      sellers.map((seller) => {
        const view = sellerOrderView(order, seller._id);
        const fulfillment = getSellerFulfillment(order, seller._id);
        // Privacy: before the seller accepts, they see only the buyer's
        // delivery state + city — never the full street address.
        const { state = "", city = "" } = order.shippingAddress || {};
        return sendEmailSafe({
          to: seller.email,
          subject: `New paid TronMarket order #${order._id}`,
          html: orderStatusEmail({
            heading: "New paid order received",
            intro: `A buyer has paid for your item(s) in order #${order._id}. Please prepare this package for fulfilment.`,
            orderId: order._id,
            status: fulfillment?.status || order.status,
            totalText: moneyText(view.sellerPayoutAmount),
            totalLabel: "Your payout after commission",
            items: (view.orderItems || []).map((item) => ({
              ...item,
              productId: item.product ? String(item.product) : "",
            })),
            metaRows: [
              ...(fulfillment?._id
                ? [{ label: "Sub-order ID", value: String(fulfillment._id) }]
                : []),
              { label: "Order date", value: orderDate },
              { label: "Delivery state", value: state || "—" },
              { label: "Delivery city", value: city || "—" },
            ],
            notice: DELIVERY_INSTRUCTION,
          }),
        });
      }),
    );
  } catch (error) {
    console.error("Seller paid-order notification failed:", error?.message || error);
  }
}

export async function notifyBuyerOrderStatus(order, status) {
  try {
    const allowed = ["shipped", "delivered", "cancelled", "completed"];
    if (!allowed.includes(status) || !order?.user) return;

    const buyer = await User.findById(order.user)
      .select("email name isDeleted")
      .lean();
    if (!buyer?.email || buyer.isDeleted) return;

    const copy = {
      shipped: [
        "Your order has shipped",
        "Good news — your TronMarket order is on its way.",
      ],
      delivered: [
        "Your order has been delivered",
        "Your TronMarket order has been marked as delivered.",
      ],
      completed: [
        "Your order is complete",
        "Thank you — your TronMarket order is now complete.",
      ],
      cancelled: [
        "Your order was cancelled",
        "Your TronMarket order has been cancelled. If you already paid and a refund applies, it will be processed through the original payment method.",
      ],
    }[status];

    await sendEmailSafe({
      to: buyer.email,
      subject: `${copy[0]} — TronMarket`,
      html: orderStatusEmail({
        heading: copy[0],
        intro: copy[1],
        orderId: order._id,
        status,
        totalText: moneyText(order.totalPrice),
        totalLabel: "Order total",
        items: order.orderItems,
      }),
    });
  } catch (error) {
    console.error("Buyer order-status notification failed:", error?.message || error);
  }
}
