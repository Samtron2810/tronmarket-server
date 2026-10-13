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
import {
  buildSellerFulfillments,
  ensureSellerFulfillments,
  getSellerFulfillment,
  effectiveFulfillmentStatus,
  setSellerFulfillmentStatus,
  isMultiSellerOrder,
  sellerOrderView,
} from "../services/orderFulfillmentService.js";
import {
  newPaymentDeadline,
  expireOrderIfDue,
  sweepExpiredOrders,
} from "../services/orderExpiryService.js";
import {
  shippingForSubtotal,
  getCommissionRate,
} from "../services/pricingService.js";
import { notifyBuyerOrderStatus } from "../services/orderNotificationService.js";
import { recordAudit } from "../services/auditService.js";

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
    // variant is chosen — never prices sent by the client). Every line must
    // be fully available: orders are never silently clamped or partially
    // fulfilled. Any problem rejects the whole checkout with a per-line
    // explanation, before any stock moves and before the cart is touched.
    const planned = [];
    const unavailable = [];
    for (const item of cart.items) {
      const product = item.product;
      const productId = item.product?._id ?? item.product;
      const variant = item.variant ?? null;
      const variantId = variant?._id ?? variant ?? null;
      const lineInfo = {
        productId,
        variantId,
        variantLabel: item.variantLabel || "",
        name: product?.name || "Unknown product",
        cartQuantity: item.quantity,
      };

      if (!product || product.isActive === false) {
        unavailable.push({
          ...lineInfo,
          reason: "unavailable",
          availableStock: 0,
        });
        continue;
      }

      if (
        variant &&
        (!variant.product ||
          variant.product.toString() !== product._id.toString() ||
          !variant.isActive)
      ) {
        unavailable.push({
          ...lineInfo,
          variantLabel:
            item.variantLabel ||
            (variant.attributes
              ? buildVariantLabel(variant.attributes)
              : ""),
          reason: "unavailable",
          availableStock: 0,
        });
        continue;
      }

      if (product.hasVariants && !variant) {
        unavailable.push({
          ...lineInfo,
          reason: "unavailable",
          availableStock: 0,
        });
        continue;
      }

      const available = variant ? (variant.stock ?? 0) : (product.stock ?? 0);
      if (!Number.isFinite(available) || available <= 0) {
        unavailable.push({
          ...lineInfo,
          reason: "out_of_stock",
          availableStock: 0,
        });
        continue;
      }

      if (item.quantity > available) {
        unavailable.push({
          ...lineInfo,
          reason: "insufficient",
          availableStock: available,
        });
        continue;
      }

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
        quantity: item.quantity,
      });
    }

    if (unavailable.length > 0) {
      return res.status(409).json({
        message:
          "Some items in your cart are no longer available. Please review your cart and try again.",
        errors: unavailable,
        details: unavailable,
      });
    }

    if (planned.length === 0) {
      return res.status(400).json({ message: "No available items in cart" });
    }

    const restoreLines = async (lines) => {
      for (const line of lines) {
        if (line.variantDoc) {
          await ProductVariant.findByIdAndUpdate(line.variantDoc._id, {
            $inc: { stock: line.quantity },
          });
        } else {
          await Product.findByIdAndUpdate(line.productDoc._id, {
            $inc: { stock: line.quantity },
          });
        }
      }
    };

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
        await restoreLines(decremented);
        return res.status(409).json({
          message: `Insufficient stock for ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ""}`,
          errors: [
            {
              productId: line.product,
              variantId: line.variant ?? null,
              variantLabel: line.variantLabel || "",
              name: line.name,
              reason: "insufficient",
              availableStock: 0,
              cartQuantity: line.quantity,
            },
          ],
          details: [
            {
              productId: line.product,
              variantId: line.variant ?? null,
              variantLabel: line.variantLabel || "",
              name: line.name,
              reason: "insufficient",
              availableStock: 0,
              cartQuantity: line.quantity,
            },
          ],
        });
      }
      decremented.push(line);
    }

    const orderItems = planned.map(
      ({ productDoc, variantDoc, ...line }) => line,
    );
    const itemsSubtotal = orderItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );
    // Shipping is always calculated by the server from the delivery state;
    // a client-supplied amount is never trusted.
    const shipping = shippingForSubtotal(
      itemsSubtotal,
      shippingAddress?.state,
    );
    const totalPrice = itemsSubtotal + shipping.amount;
    const commissionRate = getCommissionRate();
    const sellerFulfillments = buildSellerFulfillments(orderItems);

    // If order creation itself fails, every decremented unit goes back —
    // stock must never leak on a failed checkout.
    let order;
    try {
      order = await Order.create({
        user: req.user._id,
        orderItems,
        sellerFulfillments,
        itemsSubtotal,
        shippingPrice: shipping.amount,
        shippingZone: shipping.zone,
        commissionRate,
        commissionTotal: sellerFulfillments.reduce(
          (sum, f) => sum + Number(f.commissionAmount || 0),
          0,
        ),
        sellerPayoutTotal: sellerFulfillments.reduce(
          (sum, f) => sum + Number(f.payoutAmount || 0),
          0,
        ),
        totalPrice,
        shippingAddress,
        paymentExpiresAt: newPaymentDeadline(),
        statusHistory: [{ status: "pending", note: "Order placed" }],
      });
    } catch (createError) {
      await restoreLines(decremented);
      throw createError;
    }

    // Post-creation bookkeeping is best-effort: the order exists, so a
    // cache/cart hiccup must not turn this response into a 500 (which
    // would invite a duplicate order on retry).
    try {
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

      // Clear only the lines that were actually purchased.
      const purchasedKeys = new Set(
        planned.map((l) => `${l.product.toString()}:${l.variant ?? ""}`),
      );
      cart.items = cart.items.filter((item) => {
        const pid = (item.product?._id ?? item.product)?.toString();
        const vid = (item.variant?._id ?? item.variant ?? "")?.toString();
        return !purchasedKeys.has(`${pid}:${vid}`);
      });
      await cart.save();
    } catch (postError) {
      console.error("createOrder post-processing failed:", postError);
    }

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getShippingQuote = async (req, res) => {
  try {
    const state = String(req.query.state || "").trim();
    if (!state) {
      return res
        .status(400)
        .json({ message: "Delivery state is required for a shipping quote" });
    }

    const cart = await Cart.findOne({ user: req.user._id })
      .populate("items.product")
      .populate("items.variant");
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    const itemsSubtotal = cart.items.reduce((sum, item) => {
      const price = Number(item.variant?.price ?? item.product?.price ?? 0);
      return sum + price * Number(item.quantity || 0);
    }, 0);
    const shipping = shippingForSubtotal(itemsSubtotal, state);

    return res.json({
      state,
      itemsSubtotal,
      shippingPrice: shipping.amount,
      shippingZone: shipping.zone,
      freeShipping: shipping.freeShipping,
      totalPrice: itemsSubtotal + shipping.amount,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getOrderInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate(
      "user",
      "name email",
    );
    if (!order) return res.status(404).json({ message: "Order not found" });

    const isOwner = order.user?._id?.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";
    if (isOwner || isAdmin) {
      ensureSellerFulfillments(order);
      return res.json({
        invoiceType: "full",
        order: {
          ...order.toObject(),
          invoice: {
            itemsSubtotal:
              order.itemsSubtotal ||
              Math.max(0, order.totalPrice - (order.shippingPrice || 0)),
            shippingPrice: order.shippingPrice || 0,
            shippingZone: order.shippingZone || "",
            totalPrice: order.totalPrice,
            commissionTotal: order.commissionTotal || 0,
            sellerPayoutTotal: order.sellerPayoutTotal || 0,
          },
        },
      });
    }

    if (req.user.role === "seller") {
      const view = sellerOrderView(order, req.user._id);
      if (view.orderItems.length > 0) {
        return res.json({
          invoiceType: "seller",
          order: {
            ...view,
            invoice: {
              itemsSubtotal: view.sellerSubtotal,
              commissionRate: view.sellerCommissionRate,
              commissionAmount: view.sellerCommissionAmount,
              payoutAmount: view.sellerPayoutAmount,
              payoutStatus: view.payoutStatus,
              // Sellers do not see the buyer's delivery charge or other
              // sellers' amounts on their payout statement.
              shippingPrice: 0,
              totalPrice: view.sellerSubtotal,
            },
          },
        });
      }
    }

    return res.status(403).json({ message: "Not authorized for this invoice" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMyOrders = async (req, res) => {
  try {
    // Expire this buyer's due unpaid orders first so the list never shows
    // a payable order whose stock has already been released.
    await sweepExpiredOrders({ userId: req.user._id, limit: 50 }).catch(
      () => {},
    );

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ user: req.user._id })
        .populate("sellerFulfillments.seller", "name")
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
    let order = await Order.findById(req.params.id)
      .populate("user", "name email")
      .populate("sellerFulfillments.seller", "name");

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

    // The buyer never sees a stale payable order past its deadline.
    if (isOwner) {
      const result = await expireOrderIfDue(order).catch(() => null);
      if (result?.order) {
        order = await Order.findById(req.params.id)
          .populate("user", "name email")
          .populate("sellerFulfillments.seller", "name");
      }
    }

    // Sellers only ever receive their own slice of someone else's order.
    if (!isOwner && !isAdmin && req.user.role === "seller") {
      return res.json(sellerOrderView(order, req.user._id));
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

    ensureSellerFulfillments(order);

    // Multi-seller orders: a seller advances ONLY their own fulfilment.
    // They can ship/claim their items, but they can never ship, deliver or
    // cancel another seller's share — whole-order cancellation stays with
    // the buyer/admin so the single payment is refunded exactly once.
    if (req.user.role === "seller" && isMultiSellerOrder(order)) {
      if (order.refundStatus === "pending") {
        return res.status(409).json({
          message:
            "A refund is being processed for this order; it can only be cancelled",
        });
      }
      if (status === "cancelled") {
        return res.status(403).json({
          message:
            "Sellers cannot cancel a multi-seller order. Ask the customer or an admin to cancel it so the payment is handled correctly.",
        });
      }

      const fulfillment = getSellerFulfillment(order, req.user._id);
      const current = effectiveFulfillmentStatus(order, fulfillment);
      const allowedByFulfillment = {
        paid: ["processing", "shipped"],
        processing: ["shipped"],
        shipped: ["delivery-claimed"],
      };
      const allowedForSeller = allowedByFulfillment[current] || [];
      if (!allowedForSeller.includes(status)) {
        return res.status(400).json({
          message: `Your items cannot move from "${current}" to "${status}"`,
        });
      }

      setSellerFulfillmentStatus(
        order,
        req.user._id,
        status,
        note || `Seller updated their items to ${status}`,
      );
      await order.save();
      void notifyBuyerOrderStatus(order, order.status);
      return res.json(sellerOrderView(order, req.user._id));
    }

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
        if (req.user.role === "admin") {
          await recordAudit(
            req,
            "order.cancelled",
            { type: "Order", id: order._id },
            { note: note || "", totalPrice: order.totalPrice },
          );
        }
        return res.json(cancelledOrder);
      } catch (error) {
        return res
          .status(error.statusCode || 500)
          .json({ message: error.message });
      }
    }

    const previousStatus = order.status;

    // Keep fulfilment records in step with whole-order transitions
    // (admin actions, and single-seller orders where seller == order).
    for (const fulfillment of order.sellerFulfillments || []) {
      if (fulfillment.status === "cancelled") continue;
      if (
        req.user.role === "admin" ||
        fulfillment.seller?.toString() === req.user._id.toString()
      ) {
        fulfillment.status = status;
        fulfillment.statusHistory = fulfillment.statusHistory || [];
        fulfillment.statusHistory.push({
          status,
          note: note || `Order ${status}`,
        });
      }
    }

    order.status = status;
    order.statusHistory.push({ status, note });

    if (status === "delivered") {
      order.deliveredAt = new Date();
    }

    await order.save();
    void notifyBuyerOrderStatus(order, status);
    if (req.user.role === "admin") {
      await recordAudit(
        req,
        "order.status-changed",
        { type: "Order", id: order._id },
        { previousStatus, newStatus: status, note: note || "" },
      );
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSellerOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = { "orderItems.seller": req.user._id };
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("user", "name email")
        .sort("-createdAt")
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    // Each seller receives only their own items, subtotal and status.
    res.json({
      orders: orders.map((order) => sellerOrderView(order, req.user._id)),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
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

    ensureSellerFulfillments(order);
    const sellerId = req.body?.sellerId;

    // Per-seller confirmation: the buyer can receive one seller's package
    // without pretending the whole multi-seller order has arrived.
    if (sellerId) {
      const fulfillment = getSellerFulfillment(order, sellerId);
      if (!fulfillment) {
        return res
          .status(404)
          .json({ message: "Seller package not found in this order" });
      }
      const current = effectiveFulfillmentStatus(order, fulfillment);
      if (!["shipped", "delivery-claimed"].includes(current)) {
        return res.status(400).json({
          message: "This seller's items must be shipped before confirmation",
        });
      }
      setSellerFulfillmentStatus(
        order,
        sellerId,
        "delivered",
        "Delivery confirmed by customer",
      );
      if (order.status === "delivered") order.deliveredAt = new Date();
      order.statusHistory.push({
        status: order.status,
        note: "Customer confirmed delivery for one seller's items",
      });
      await order.save();
      return res.json({
        success: true,
        message: "Delivery confirmed for this seller's items",
        order,
      });
    }

    if (isMultiSellerOrder(order)) {
      let confirmed = 0;
      for (const fulfillment of order.sellerFulfillments) {
        const current = effectiveFulfillmentStatus(order, fulfillment);
        if (["shipped", "delivery-claimed"].includes(current)) {
          setSellerFulfillmentStatus(
            order,
            fulfillment.seller,
            "delivered",
            "Delivery confirmed by customer",
          );
          confirmed += 1;
        }
      }
      if (confirmed === 0) {
        return res
          .status(400)
          .json({ message: "No shipped items are ready to confirm" });
      }
      if (order.status === "delivered") order.deliveredAt = new Date();
      order.statusHistory.push({
        status: order.status,
        note: "Delivery confirmed by customer",
      });
      await order.save();
      if (order.status === "delivered") {
        void notifyBuyerOrderStatus(order, "delivered");
      }
      return res.json({ success: true, message: "Order marked as delivered", order });
    }

    if (!["shipped", "delivery-claimed"].includes(order.status)) {
      return res
        .status(400)
        .json({ message: "Order must be shipped before confirmation" });
    }

    order.status = "delivered";
    order.deliveredAt = new Date();
    for (const fulfillment of order.sellerFulfillments || []) {
      if (fulfillment.status !== "cancelled") fulfillment.status = "delivered";
    }
    order.statusHistory.push({
      status: "delivered",
      note: "Delivery confirmed by customer",
    });
    await order.save();
    void notifyBuyerOrderStatus(order, "delivered");

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

    ensureSellerFulfillments(order);

    // Multi-seller: claiming delivery only applies to the caller's own
    // shipped items; the order-level status is then re-derived.
    if (req.user.role === "seller" && isMultiSellerOrder(order)) {
      const fulfillment = getSellerFulfillment(order, req.user._id);
      const current = effectiveFulfillmentStatus(order, fulfillment);
      if (current !== "shipped") {
        return res.status(400).json({
          message: "You can only claim delivery on your shipped items",
        });
      }
      setSellerFulfillmentStatus(
        order,
        req.user._id,
        "delivery-claimed",
        "Delivery claimed by seller. Awaiting Admin finalization.",
      );
      await order.save();
      return res.json({
        success: true,
        message: "Delivery claim filed. Admin will review and complete.",
        order: sellerOrderView(order, req.user._id),
      });
    }

    if (order.status !== "shipped") {
      return res
        .status(400)
        .json({ message: "You can only claim delivery on shipped orders" });
    }

    order.status = "delivery-claimed";
    for (const fulfillment of order.sellerFulfillments || []) {
      if (fulfillment.status === "shipped") {
        fulfillment.status = "delivery-claimed";
      }
    }

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
      order:
        req.user.role === "seller"
          ? sellerOrderView(order, req.user._id)
          : order,
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

    ensureSellerFulfillments(order);
    const previousStatus = order.status;
    order.status = "completed";
    for (const fulfillment of order.sellerFulfillments || []) {
      if (fulfillment.status !== "cancelled") {
        fulfillment.status = "completed";
        fulfillment.statusHistory = fulfillment.statusHistory || [];
        fulfillment.statusHistory.push({
          status: "completed",
          note: "Order manually finalized by Admin",
        });
      }
    }
    order.statusHistory.push({
      status: "completed",
      note: "Order manually finalized by Admin",
    });
    await order.save();
    void notifyBuyerOrderStatus(order, "completed");
    await recordAudit(
      req,
      "order.manually-completed",
      { type: "Order", id: order._id },
      { previousStatus, newStatus: "completed" },
    );

    res.json({
      success: true,
      message: "Order manually finalized by Admin",
      order,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
