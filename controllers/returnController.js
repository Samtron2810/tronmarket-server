import Order from "../models/Order.js";
import ReturnRequest from "../models/ReturnRequest.js";

const RETURNABLE = ["paid", "processing", "shipped", "delivered"];

export const createReturnRequest = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!RETURNABLE.includes(order.status)) {
      return res.status(409).json({ message: "This order cannot be returned yet" });
    }
    const existing = await ReturnRequest.findOne({
      order: order._id,
      status: { $in: ["requested", "approved"] },
    });
    if (existing) return res.status(409).json({ message: "A return is already open for this order" });

    const request = await ReturnRequest.create({
      order: order._id,
      user: req.user._id,
      reason: String(req.body.reason || "").trim().slice(0, 300),
      details: String(req.body.details || "").trim().slice(0, 2000),
      items: Array.isArray(req.body.items)
        ? req.body.items.slice(0, 20).map((i) => ({
            product: i.product,
            variant: i.variant || null,
            name: String(i.name || "").slice(0, 200),
            quantity: Math.max(1, Math.min(99, Number(i.quantity) || 1)),
          }))
        : order.items.map((i) => ({ product: i.product, variant: i.variant || null, name: i.name, quantity: i.quantity })),
    });
    return res.status(201).json(request);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Could not open the return request" });
  }
};

export const myReturns = async (req, res) => {
  try {
    const returns = await ReturnRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("order", "totalPrice status createdAt")
      .lean();
    return res.json(returns);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load return requests" });
  }
};

export const orderReturnStatus = async (req, res) => {
  try {
    const request = await ReturnRequest.findOne({ order: req.params.orderId, user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    return res.json(request || null);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load return status" });
  }
};
