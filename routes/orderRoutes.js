import express from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderStatus,
  getSellerOrders,
  getOrders,
  cancelOrder,
  confirmDelivery,
  sellerDeliveryClaim,
  completeOrderManually,
} from "../controllers/orderController.js";

import {
  protect,
  adminOnly,
  sellerOrAdmin,
} from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  createOrderSchema,
  updateOrderStatusSchema,
} from "../validations/orderSchemas.js";
import { checkoutLimiter } from "../middlewares/rateLimiter.js";

const router = express.Router();

// POST /api/orders — Protected, rate limited, Zod validates shipping address
router.post(
  "/",
  protect,
  checkoutLimiter,
  validate(createOrderSchema),
  createOrder,
);

// GET /api/orders/my-orders — Protected
router.get("/my-orders", protect, getMyOrders);

// GET /api/orders/seller/orders — Seller/Admin
router.get("/seller/orders", protect, sellerOrAdmin, getSellerOrders);

// GET /api/orders — Admin only
router.get("/", protect, adminOnly, getOrders);

// GET /api/orders/:id — Protected
router.get("/:id", protect, getOrderById);

// PUT /api/orders/:id/cancel — Protected (customer cancels own order)
router.put("/:id/cancel", protect, cancelOrder);

// PUT /api/orders/:id/status — Seller/Admin, Zod validates
router.put(
  "/:id/status",
  protect,
  sellerOrAdmin,
  validate(updateOrderStatusSchema),
  updateOrderStatus,
);

// PUT /api/orders/:id/deliver — Customer confirms delivery
router.put("/:id/deliver", protect, confirmDelivery);

// PUT /api/orders/:id/seller-delivery-claim — Seller/Admin
router.put(
  "/:id/seller-delivery-claim",
  protect,
  sellerOrAdmin,
  sellerDeliveryClaim,
);

// PUT /api/orders/:id/complete — Admin only
router.put("/:id/complete", protect, adminOnly, completeOrderManually);

export default router;
