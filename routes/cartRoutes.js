import express from "express";
import {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  validateCart,
  mergeGuestCart,
} from "../controllers/cartController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  addToCartSchema,
  updateCartItemSchema,
  mergeCartSchema,
} from "../validations/cartSchemas.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

const router = express.Router();

router.use(protect);

router.get("/", getCart);

router.post("/", validate(addToCartSchema), addToCart);

// POST /api/cart/validate — must be defined BEFORE /:productId
// so Express does not match "validate" as a productId param
router.post("/validate", validateCart);

// Merge a browser-held guest cart into the account cart after login.
router.post("/merge", validate(mergeCartSchema), mergeGuestCart);

// Variant-aware line addressing: /:productId/:variantId identifies one
// variant line; the /:productId-only form still matches legacy lines.
router.put(
  "/:productId/:variantId",
  validateObjectIdParams("productId", "variantId"),
  validate(updateCartItemSchema),
  updateCartItem,
);
router.put(
  "/:productId",
  validateObjectIdParams("productId"),
  validate(updateCartItemSchema),
  updateCartItem,
);

router.delete(
  "/:productId/:variantId",
  validateObjectIdParams("productId", "variantId"),
  removeCartItem,
);
router.delete(
  "/:productId",
  validateObjectIdParams("productId"),
  removeCartItem,
);

router.delete("/", clearCart);

export default router;
