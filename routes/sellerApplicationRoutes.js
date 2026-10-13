import express from "express";
import {
  createSellerApplication,
  getMySellerApplication,
} from "../controllers/sellerApplicationController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { createSellerApplicationSchema } from "../validations/sellerApplicationSchemas.js";
import { generalLimiter } from "../middlewares/rateLimiter.js";

const router = express.Router();

router.post(
  "/",
  protect,
  generalLimiter,
  validate(createSellerApplicationSchema),
  createSellerApplication,
);
router.get("/mine", protect, getMySellerApplication);

export default router;
