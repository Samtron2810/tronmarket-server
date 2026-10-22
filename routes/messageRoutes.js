import express from "express";
import { z } from "zod";
import { getOrderThread, postOrderMessage } from "../controllers/messageController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

const router = express.Router();

const messageSchema = z.object({
  body: z.string().trim().min(1, "Write a message first").max(1000, "Keep messages under 1000 characters"),
  sellerId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid seller").optional(),
});

router.get("/:orderId", protect, validateObjectIdParams("orderId"), getOrderThread);
router.post(
  "/:orderId",
  protect,
  validateObjectIdParams("orderId"),
  validate(messageSchema),
  postOrderMessage,
);

export default router;
