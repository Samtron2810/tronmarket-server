import express from "express";
import { listPayouts, markPayoutPaid, myPayouts } from "../controllers/payoutController.js";
import { protect, adminOnly, sellerOrAdmin } from "../middlewares/authMiddleware.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

const router = express.Router();
router.get("/mine", protect, sellerOrAdmin, myPayouts);
router.get("/", protect, adminOnly, listPayouts);
router.post("/:sellerId/mark-paid", protect, adminOnly, validateObjectIdParams("sellerId"), markPayoutPaid);

export default router;
