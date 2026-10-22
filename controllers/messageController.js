import Order from "../models/Order.js";
import OrderMessage from "../models/OrderMessage.js";
import { ensureSellerFulfillments } from "../services/orderFulfillmentService.js";

// Buyer <-> seller messages, one thread per (order, seller).
//   * a buyer can open the thread with any seller on their order (sellerId);
//   * a seller only ever sees the thread with themselves on orders they sell on;
//   * an admin can open any thread on an order (sellerId required).
// Posting needs the order to be paid, so the thread is about a real purchase.

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const isObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value || ""));

async function resolveThread(req, orderId, requestedSellerId) {
  const order = await Order.findById(orderId);
  if (!order) throw httpError(404, "Order not found");
  ensureSellerFulfillments(order);

  const hasSeller = (id) =>
    order.sellerFulfillments.some((f) => String(f.seller) === String(id));

  let role;
  let sellerId;
  if (req.user.role === "admin") {
    role = "admin";
    sellerId = requestedSellerId;
  } else if (String(order.user) === String(req.user._id)) {
    role = "buyer";
    sellerId = requestedSellerId;
  } else if (req.user.role === "seller" && hasSeller(req.user._id)) {
    role = "seller";
    sellerId = String(req.user._id);
  } else {
    throw httpError(403, "You are not part of this order");
  }

  if (!isObjectId(sellerId) || !hasSeller(sellerId)) {
    throw httpError(400, "Choose the seller on this order you want to message");
  }
  return { order, role, sellerId: String(sellerId) };
}

const shape = (message, viewerId) => ({
  _id: message._id,
  body: message.body,
  senderRole: message.senderRole,
  createdAt: message.createdAt,
  mine: String(message.sender) === String(viewerId),
});

export const getOrderThread = async (req, res) => {
  try {
    const { role, sellerId } = await resolveThread(req, req.params.orderId, req.query.sellerId);
    const messages = await OrderMessage.find({
      order: req.params.orderId,
      seller: sellerId,
    })
      .sort({ createdAt: 1 })
      .limit(300)
      .lean();
    return res.json({
      role,
      sellerId,
      messages: messages.map((m) => shape(m, req.user._id)),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Could not load messages",
    });
  }
};

export const postOrderMessage = async (req, res) => {
  try {
    const { order, role, sellerId } = await resolveThread(
      req,
      req.params.orderId,
      req.body.sellerId,
    );
    if (!order.isPaid) {
      throw httpError(409, "Messages open once the order has been paid");
    }
    const created = await OrderMessage.create({
      order: order._id,
      seller: sellerId,
      sender: req.user._id,
      senderRole: role,
      body: req.body.body,
    });
    return res.status(201).json(shape(created, req.user._id));
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Could not send the message",
    });
  }
};
