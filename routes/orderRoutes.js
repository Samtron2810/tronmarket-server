import express from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderStatus,
} from "../controllers/orderController.js";

import { protect, adminOnly } from "../middlewares/authMiddleware.js";
import { sellerOnly } from "../middlewares/authMiddleware.js";
import { getSellerOrders } from "../controllers/orderController.js";

const router = express.Router();

router.post("/", protect, createOrder);

router.get("/my-orders", protect, getMyOrders);

router.get("/:id", protect, getOrderById);

router.put("/:id/status", protect, adminOnly, updateOrderStatus);

router.get("/seller/orders", protect, sellerOnly, getSellerOrders);

export default router;
