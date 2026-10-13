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
import { validate } from "../middlewares/validate.js";
import {
  addToCartSchema,
  updateCartItemSchema,
} from "../validations/cartSchemas.js";

const router = express.Router();

router.use(protect);

router.get("/", getCart);

router.post("/", validate(addToCartSchema), addToCart);

// POST /api/cart/validate — must be defined BEFORE /:productId
// so Express does not match "validate" as a productId param
router.post("/validate", validateCart);

// Variant-aware line addressing: /:productId/:variantId identifies one
// variant line; the /:productId-only form still matches legacy lines.
router.put("/:productId/:variantId", validate(updateCartItemSchema), updateCartItem);
router.put("/:productId", validate(updateCartItemSchema), updateCartItem);

router.delete("/:productId/:variantId", removeCartItem);
router.delete("/:productId", removeCartItem);

router.delete("/", clearCart);

export default router;
