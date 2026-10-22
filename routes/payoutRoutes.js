import express from "express";
import { z } from "zod";
import {
  getMyBankDetails,
  listPayouts,
  markPayoutPaid,
  myPayouts,
  saveMyBankDetails,
  setBankVerified,
} from "../controllers/payoutController.js";
import { protect, adminOnly, sellerOnly, sellerOrAdmin } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

const router = express.Router();

const bankDetailsSchema = z.object({
  bankName: z.string().trim().min(2, "Enter the bank name").max(100),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Account number must be 10 digits"),
  accountName: z.string().trim().min(3, "Enter the account name").max(120),
});

const verifySchema = z.object({ verified: z.boolean() });

router.get("/mine", protect, sellerOrAdmin, myPayouts);
router.get("/bank-details", protect, sellerOnly, getMyBankDetails);
router.put("/bank-details", protect, sellerOnly, validate(bankDetailsSchema), saveMyBankDetails);

router.get("/", protect, adminOnly, listPayouts);
router.post("/:sellerId/mark-paid", protect, adminOnly, validateObjectIdParams("sellerId"), markPayoutPaid);
router.patch(
  "/:sellerId/bank-verified",
  protect,
  adminOnly,
  validateObjectIdParams("sellerId"),
  validate(verifySchema),
  setBankVerified,
);

export default router;
