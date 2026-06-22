import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";

export const createOrder = async (req, res) => {
  try {
    const { shippingAddress } = req.body;

    const cart = await Cart.findOne({ user: req.user._id }).populate(
      "items.product",
    );

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    const orderItems = cart.items
      .filter(
        (item) => item.product && item.product.stock && item.product.stock > 0,
      )
      .map((item) => ({
        product: item.product._id,
        name: item.product.name,
        image: item.product.image,
        seller: item.product.seller,
        price: item.product.price,
        quantity: Math.min(item.quantity, item.product.stock),
      }));

    const totalPrice = orderItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );

    if (orderItems.length === 0) {
      return res.status(400).json({ message: "No available items in cart" });
    }

    const order = await Order.create({
      user: req.user._id,
      orderItems,
      totalPrice,
      shippingAddress,
      statusHistory: [{ status: "pending", note: "Order placed" }],
    });

    // Decrement stock for each ordered product
    await Promise.all(
      orderItems.map((item) =>
        Product.findByIdAndUpdate(item.product, {
          $inc: { stock: -item.quantity },
        }),
      ),
    );

    cart.items = [];
    await cart.save();

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort("-createdAt");
    res.json(orders);
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

    // Enforce valid forward-only status transitions
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

    const nonCancellableStates = ["shipped", "delivered", "cancelled"];
    if (nonCancellableStates.includes(order.status)) {
      return res.status(400).json({
        message: `Cannot cancel an order that is already ${order.status}`,
      });
    }

    if (order.orderItems?.length > 0) {
      await Promise.all(
        order.orderItems.map((item) =>
          Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity },
          }),
        ),
      );
    }

    order.status = "cancelled";
    order.statusHistory.push({
      status: "cancelled",
      note: "Cancelled by customer",
    });
    await order.save();

    res.json({
      success: true,
      message: "Order cancelled successfully and inventory restored",
      order,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Confirm delivery by customer
// @route   PUT /api/orders/:id/deliver
// @access  Private (Customer Only)
export const confirmDelivery = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only allow if it was previously shipped
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

// @desc    Seller claims delivery when buyer refuses to click confirm
// @route   PUT /api/orders/:id/seller-delivery-claim
// @access  Private (Seller/Admin)
export const sellerDeliveryClaim = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status !== "shipped") {
      return res
        .status(400)
        .json({ message: "You can only claim delivery on shipped orders" });
    }

    // Update status to indicate a claim has been filed — Admin must finalize
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

// @desc    Admin manually closes the order after verifying proof or waiting out disputes
// @route   PUT /api/orders/:id/complete
// @access  Private (Admin Only)
export const completeOrderManually = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Admin can force complete a shipped or delivered order
    if (order.status !== "delivered" && order.status !== "shipped") {
      return res
        .status(400)
        .json({ message: "Can only complete shipped or delivered orders" });
    }

    order.status = "completed";
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
