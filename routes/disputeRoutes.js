import express from "express";
import { z } from "zod";
import { listDisputes, myDisputes, openDispute, resolveDispute } from "../controllers/disputeController.js";
import { protect, adminOnly } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

const router = express.Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const openDisputeSchema = z.object({
  orderId: objectId,
  sellerIds: z.array(objectId).min(1, "Choose the package(s) you did not receive").max(20),
  reason: z.string().trim().min(3, "Tell us what happened").max(300),
  details: z.string().trim().max(2000).optional(),
});

const resolveSchema = z.object({
  decision: z.enum(["release", "uphold"], { error: "Decision must be release or uphold" }),
  note: z.string().trim().max(1000).optional(),
});

router.post("/", protect, validate(openDisputeSchema), openDispute);
router.get("/mine", protect, myDisputes);

router.get("/admin", protect, adminOnly, listDisputes);
router.patch(
  "/admin/:id",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  validate(resolveSchema),
  resolveDispute,
);

export default router;
