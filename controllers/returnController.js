import Order from "../models/Order.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { POLICY, addDays } from "../services/orderPolicy.js";

// Returns are only for delivered orders, within the return window after
// delivery. (Before delivery the buyer cancels instead; after the window the
// order completes and the money is released to the seller.)

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function deliveredAtOf(order) {
  const stamps = (order.sellerFulfillments || [])
    .map((f) => f.deliveredAt)
    .filter(Boolean)
    .map((d) => new Date(d).getTime());
  if (stamps.length) return new Date(Math.max(...stamps));
  return order.deliveredAt || order.updatedAt || null;
}

function lineSnapshot(line, quantity) {
  return {
    product: line.product,
    seller: line.seller || null,
    variant: line.variant || null,
    variantLabel: line.variantLabel || "",
    name: line.name || "",
    quantity,
    price: line.price || 0,
  };
}

// Build the return lines from the order itself. Client-sent names, prices and
// sellers are ignored. With no selection the whole order is returned.
function buildReturnItems(order, requested) {
  const lines = order.orderItems || [];
  if (!Array.isArray(requested) || requested.length === 0) {
    return lines.map((line) => lineSnapshot(line, line.quantity || 1));
  }

  const picked = new Map(); // line index -> quantity
  for (const choice of requested.slice(0, 50)) {
    const productId = String(choice.product || "");
    const variantId = choice.variant ? String(choice.variant) : "";
    const quantity = Math.max(1, Math.min(99, Number(choice.quantity) || 1));
    const index = lines.findIndex(
      (line) => String(line.product) === productId && String(line.variant || "") === variantId,
    );
    if (index === -1) throw httpError(400, "One of the selected items is not part of this order");
    picked.set(index, (picked.get(index) || 0) + quantity);
    if (picked.get(index) > (lines[index].quantity || 1)) {
      throw httpError(400, `You can return at most ${lines[index].quantity} of ${lines[index].name}`);
    }
  }
  return [...picked.entries()].map(([index, quantity]) => lineSnapshot(lines[index], quantity));
}

export const createReturnRequest = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status === "completed") {
      return res.status(409).json({ message: "The return window for this order has closed" });
    }
    if (order.status !== "delivered") {
      return res.status(409).json({ message: "Returns can only be requested once the order is delivered" });
    }
    if (["pending", "processed"].includes(order.refundStatus)) {
      return res.status(409).json({ message: "A refund is already in progress for this order" });
    }

    const deliveredAt = deliveredAtOf(order);
    if (!deliveredAt || new Date() > addDays(deliveredAt, POLICY.returnWindowDays)) {
      return res.status(409).json({
        message: `Returns must be requested within ${POLICY.returnWindowDays} days of delivery`,
      });
    }

    const existing = await ReturnRequest.findOne({
      order: order._id,
      status: { $in: ["requested", "approved"] },
    });
    if (existing) return res.status(409).json({ message: "A return is already open for this order" });

    const items = buildReturnItems(order, req.body.items);
    const sellers = [...new Set(items.map((i) => String(i.seller || "")).filter(Boolean))];

    const request = await ReturnRequest.create({
      order: order._id,
      user: req.user._id,
      reason: String(req.body.reason || "").trim().slice(0, 300),
      details: String(req.body.details || "").trim().slice(0, 2000),
      items,
      sellers,
      status: "requested",
    });
    return res.status(201).json(request);
  } catch (error) {
    return res.status(error.status || 400).json({
      message: error.message || "Could not open the return request",
    });
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
