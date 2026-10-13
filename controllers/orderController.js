import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import ProductVariant from "../models/ProductVariant.js";
import {
  variantLabel as buildVariantLabel,
  syncProductSummary,
} from "../services/variantService.js";
import { invalidateProductCache, cacheDel } from "../config/redis.js";
import { cancelOrderWithRefund } from "../services/orderCancellationService.js";

export const createOrder = async (req, res) => {
  try {
    const { shippingAddress } = req.body;

    const cart = await Cart.findOne({ user: req.user._id })
      .populate("items.product")
      .populate("items.variant");

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    // Defence in depth: never let a corrupted cart line (negative or
    // fractional quantity, however it got there) become an order line —
    // it would corrupt the total and the stock decrement.
    for (const item of cart.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        return res.status(400).json({
          message:
            "Your cart contains an invalid quantity. Please review your cart and try again.",
        });
      }
    }

    // Plan order lines from server-side truth (variant price/stock when a
    // variant is chosen — never prices sent by the client).
    const planned = [];
    for (const item of cart.items) {
      const product = item.product;
      if (!product) continue;

      const variant = item.variant ?? null;
      if (product.hasVariants && (!variant || !variant.isActive)) continue;

      const available = variant ? (variant.stock ?? 0) : (product.stock ?? 0);
      if (available <= 0) continue;

      const quantity = Math.min(item.quantity, available);
      planned.push({
        productDoc: product,
        variantDoc: variant,
        product: product._id,
        variant: variant?._id,
        variantLabel:
          item.variantLabel ||
          (variant ? buildVariantLabel(variant.attributes) : ""),
        sku: item.sku || variant?.sku || "",
        name: product.name,
        image: variant?.image || product.image,
        seller: product.seller,
        price: variant ? variant.price : product.price,
        quantity,
      });
    }

    if (planned.length === 0) {
      return res.status(400).json({ message: "No available items in cart" });
    }

    // Atomically decrement stock per line (variant document when present).
    // The stock >= qty filter makes overselling the last unit impossible;
    // on any failure, already-taken stock is returned and no order is made.
    const decremented = [];
    for (const line of planned) {
      const updated = line.variantDoc
        ? await ProductVariant.findOneAndUpdate(
            {
              _id: line.variantDoc._id,
              isActive: true,
              stock: { $gte: line.quantity },
            },
            { $inc: { stock: -line.quantity } },
            { new: true },
          )
        : await Product.findOneAndUpdate(
            { _id: line.productDoc._id, stock: { $gte: line.quantity } },
            { $inc: { stock: -line.quantity } },
            { new: true },
          );

      if (!updated) {
        for (const done of decremented) {
          if (done.variantDoc) {
            await ProductVariant.findByIdAndUpdate(done.variantDoc._id, {
              $inc: { stock: done.quantity },
            });
          } else {
            await Product.findByIdAndUpdate(done.productDoc._id, {
              $inc: { stock: done.quantity },
            });
          }
        }
        return res.status(400).json({
          message: `Insufficient stock for ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ""}`,
        });
      }
      decremented.push(line);
    }

    const orderItems = planned.map(
      ({ productDoc, variantDoc, ...line }) => line,
    );
    const totalPrice = orderItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );

    const order = await Order.create({
      user: req.user._id,
      orderItems,
      totalPrice,
      shippingAddress,
      statusHistory: [{ status: "pending", note: "Order placed" }],
    });

    // Keep derived product summaries in step with variant stock changes.
    const affectedProductIds = [
      ...new Set(planned.map((l) => l.product.toString())),
    ];
    for (const pid of affectedProductIds) {
      const doc = planned.find((l) => l.product.toString() === pid).productDoc;
      if (doc.hasVariants) await syncProductSummary(pid);
    }

    const sellerIds = [
      ...new Set(orderItems.map((item) => item.seller?.toString())),
    ];

    await invalidateProductCache();

    for (const sellerId of sellerIds) {
      if (sellerId) {
        await cacheDel(`product:seller:${sellerId}`);
      }
    }

    for (const item of orderItems) {
      await cacheDel(`product:single:${item.product}`);
    }

    cart.items = [];
    await cart.save();

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMyOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ user: req.user._id })
        .sort("-createdAt")
        .skip(skip)
        .limit(limit),
      Order.countDocuments({ user: req.user._id }),
    ]);

    res.json({
      orders,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate(
      "user",
      "name email",
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isOwner = order.user._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";
    const isSellerInOrder = order.orderItems.some(
      (item) =>
        item.seller && item.seller.toString() === req.user._id.toString(),
    );

    if (!isOwner && !isAdmin && !isSellerInOrder) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (req.user.role === "seller") {
      const isSellerInOrder = order.orderItems.some(
        (item) =>
          item.seller && item.seller.toString() === req.user._id.toString(),
      );

      if (!isSellerInOrder) {
        return res.status(403).json({ message: "Unauthorized" });
      }
    }

    const { status, note } = req.body;

    const validTransitions = {
      pending: ["processing", "cancelled"],
      paid: ["processing", "shipped", "cancelled"],
      processing: ["shipped", "cancelled"],
      shipped: ["delivered", "delivery-claimed"],
      "delivery-claimed": ["delivered", "completed"],
      delivered: ["completed"],
    };

    const allowed = validTransitions[order.status];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({
        message: `Cannot transition order from "${order.status}" to "${status}"`,
      });
    }

    // A refund is in flight for this order — the only safe next step is
    // finishing the cancellation, not shipping or processing it.
    if (order.refundStatus === "pending" && status !== "cancelled") {
      return res.status(409).json({
        message:
          "A refund is being processed for this order; it can only be cancelled",
      });
    }

    // Cancellation always goes through the shared refund + restock path,
    // including for paid orders — never a bare status flip that keeps the
    // customer's money and strands the reserved stock.
    if (status === "cancelled") {
      try {
        const { order: cancelledOrder } = await cancelOrderWithRefund(order, {
          allowedStatuses: [order.status],
          note: note || `Cancelled by ${req.user.role}`,
          refundReason: `Order cancelled by ${req.user.role}`,
        });
        return res.json(cancelledOrder);
      } catch (error) {
        return res
          .status(error.statusCode || 500)
          .json({ message: error.message });
      }
    }

    order.status = status;
    order.statusHistory.push({ status, note });

    if (status === "delivered") {
      order.deliveredAt = new Date();
    }

    await order.save();

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSellerOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      "orderItems.seller": req.user._id,
    }).populate("user", "name email");

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({})
        .populate("user", "name email")
        .sort("-createdAt")
        .skip(skip)
        .limit(limit),
      Order.countDocuments({}),
    ]);

    res.json({
      orders,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Not authorized to cancel this order" });
    }

    if (order.status === "cancelled") {
      return res
        .status(400)
        .json({ message: "Order has already been cancelled" });
    }

    // Paid orders are only cancelled once a Paystack refund has been
    // requested (handled inside cancelOrderWithRefund); if the refund
    // cannot be requested the cancellation aborts with an error and the
    // order keeps its status and reserved stock.
    const { order: cancelledOrder } = await cancelOrderWithRefund(order, {
      allowedStatuses: ["pending", "paid", "processing"],
      note: "Cancelled by customer",
      refundReason: "Order cancelled by customer",
    });

    const refundMessage =
      cancelledOrder.refundStatus === "processed"
        ? " Your payment has been refunded."
        : cancelledOrder.refundStatus === "pending"
          ? " Your refund has been requested from Paystack."
          : "";

    res.json({
      success: true,
      message: `Order cancelled successfully and inventory restored.${refundMessage}`,
      order: cancelledOrder,
    });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ message: error.message || "Failed to cancel order." });
  }
};

export const confirmDelivery = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.user.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Not authorized to confirm this delivery" });
    }

    if (order.status !== "shipped") {
      return res
        .status(400)
        .json({ message: "Order must be shipped before confirmation" });
    }

    order.status = "delivered";
    order.deliveredAt = new Date();
    order.statusHistory.push({
      status: "delivered",
      note: "Delivery confirmed by customer",
    });
    await order.save();

    res.json({ success: true, message: "Order marked as delivered", order });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const sellerDeliveryClaim = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // A seller may only claim delivery on an order that actually contains
    // their items (same ownership rule as updateOrderStatus). Admins may
    // claim on any order.
    if (req.user.role === "seller") {
      const isSellerInOrder = order.orderItems.some(
        (item) =>
          item.seller && item.seller.toString() === req.user._id.toString(),
      );

      if (!isSellerInOrder) {
        return res.status(403).json({ message: "Unauthorized" });
      }
    }

    if (order.status !== "shipped") {
      return res
        .status(400)
        .json({ message: "You can only claim delivery on shipped orders" });
    }

    order.status = "delivery-claimed";

    if (order.statusHistory) {
      order.statusHistory.push({
        status: "delivery-claimed",
        note: "Delivery claimed by seller. Awaiting Admin finalization.",
      });
    }

    await order.save();
    res.json({
      success: true,
      message: "Delivery claim filed. Admin will review and complete.",
      order,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const completeOrderManually = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const completableStatuses = ["shipped", "delivery-claimed", "delivered"];
    if (!completableStatuses.includes(order.status)) {
      return res.status(400).json({
        message:
          "Can only complete shipped, delivery-claimed, or delivered orders",
      });
    }

    order.status = "completed";
    order.statusHistory.push({
      status: "completed",
      note: "Order manually finalized by Admin",
    });
    await order.save();

    res.json({
      success: true,
      message: "Order manually finalized by Admin",
      order,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
