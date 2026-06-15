import express from "express";
import {
  verifyPayment,
  paystackWebhook,
} from "../controllers/paymentController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/webhook", paystackWebhook);
router.post("/verify", protect, verifyPayment);

export default router;
