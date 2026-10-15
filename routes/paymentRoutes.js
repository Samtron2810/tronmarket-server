import express from "express";
import {
  initializePayment,
  verifyPayment,
  paystackWebhook,
} from "../controllers/paymentController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { checkoutLimiter } from "../middlewares/rateLimiter.js";
import { validate } from "../middlewares/validate.js";
import {
  initializePaymentSchema,
  verifyPaymentSchema,
} from "../validations/paymentSchemas.js";

const router = express.Router();

router.post("/webhook", paystackWebhook);
router.post(
  "/initialize",
  protect,
  checkoutLimiter,
  validate(initializePaymentSchema),
  initializePayment,
);
router.post(
  "/verify",
  protect,
  checkoutLimiter,
  validate(verifyPaymentSchema),
  verifyPayment,
);

export default router;
