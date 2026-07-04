import express from "express";
import {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  validateCart,
} from "../controllers/cartController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getCart);

router.post("/", addToCart);

// POST /api/cart/validate — must be defined BEFORE /:productId
// so Express does not match "validate" as a productId param
router.post("/validate", validateCart);

router.put("/:productId", updateCartItem);

router.delete("/:productId", removeCartItem);

router.delete("/", clearCart);

export default router;
