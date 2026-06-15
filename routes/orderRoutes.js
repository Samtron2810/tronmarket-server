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

const router = express.Router();

router.post("/", protect, createOrder);

router.get("/my-orders", protect, getMyOrders);

router.get("/seller/orders", protect, sellerOrAdmin, getSellerOrders);

router.get("/", protect, adminOnly, getOrders);

router.get("/:id", protect, getOrderById);

router.put("/:id/cancel", protect, cancelOrder);

router.put("/:id/status", protect, sellerOrAdmin, updateOrderStatus);

// 1. Customer confirms everything is perfect
router.put("/:id/deliver", protect, confirmDelivery);
// 2. Seller bypasses a silent/dishonest buyer (uses your sellerOrAdmin middleware)
router.put(
  "/:id/seller-delivery-claim",
  protect,
  sellerOrAdmin,
  sellerDeliveryClaim,
);
// 3. Admin shuts down the entire transaction file permanently
router.put("/:id/complete", protect, adminOnly, completeOrderManually);

export default router;
