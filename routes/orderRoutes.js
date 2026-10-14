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
  getShippingQuote,
  getOrderInvoice,
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
import {
  createReturnRequest,
  myReturns,
  orderReturnStatus,
} from "../controllers/returnController.js";
import { z } from "zod";

const createReturnSchema = z.object({
  reason: z.string().trim().min(3, "Tell us why you are returning this").max(300),
  details: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        product: z.string().optional(),
        variant: z.string().nullable().optional(),
        name: z.string().optional(),
        quantity: z.number().int().min(1).max(99).optional(),
      }),
    )
    .optional(),
});
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

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

// Returns — must precede /:id so "returns" is not parsed as an order id
router.get("/returns/mine", protect, myReturns);

// GET /api/orders/seller/orders — Seller/Admin
router.get("/seller/orders", protect, sellerOrAdmin, getSellerOrders);

// GET /api/orders — Admin only
router.get("/", protect, adminOnly, getOrders);

// Shipping is quoted by the server from the delivery state. Defined before
// /:id so "shipping-quote" is never interpreted as an order id.
router.get("/shipping-quote", protect, getShippingQuote);

// GET /api/orders/:id/invoice — buyer/admin full invoice; seller payout view
router.get(
  "/:id/invoice",
  protect,
  validateObjectIdParams("id"),
  getOrderInvoice,
);

// GET /api/orders/:id — Protected
router.get("/:id", protect, validateObjectIdParams("id"), getOrderById);

// PUT /api/orders/:id/cancel — Protected (customer cancels own order)
router.put("/:id/cancel", protect, validateObjectIdParams("id"), cancelOrder);

// PUT /api/orders/:id/status — Seller/Admin, Zod validates
router.put(
  "/:id/status",
  protect,
  sellerOrAdmin,
  validateObjectIdParams("id"),
  validate(updateOrderStatusSchema),
  updateOrderStatus,
);

// PUT /api/orders/:id/deliver — Customer confirms delivery
router.put(
  "/:id/deliver",
  protect,
  validateObjectIdParams("id"),
  confirmDelivery,
);

// PUT /api/orders/:id/seller-delivery-claim — Seller/Admin
router.put(
  "/:id/seller-delivery-claim",
  protect,
  sellerOrAdmin,
  validateObjectIdParams("id"),
  sellerDeliveryClaim,
);

// PUT /api/orders/:id/complete — Admin only
router.put(
  "/:id/complete",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  completeOrderManually,
);

router.get(
  "/:id/return",
  protect,
  validateObjectIdParams("id"),
  (req, res, next) => {
    req.params.orderId = req.params.id;
    return orderReturnStatus(req, res, next);
  },
);
router.post(
  "/:id/return",
  protect,
  validateObjectIdParams("id"),
  validate(createReturnSchema),
  (req, res, next) => {
    req.params.orderId = req.params.id;
    return createReturnRequest(req, res, next);
  },
);

export default router;
