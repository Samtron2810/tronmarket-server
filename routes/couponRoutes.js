import express from "express";
import { validateCoupon } from "../controllers/couponController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { validateCouponSchema } from "../validations/couponSchemas.js";

const router = express.Router();
router.post("/validate", protect, validate(validateCouponSchema), validateCoupon);

export default router;
