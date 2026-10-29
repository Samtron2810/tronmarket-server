import express from "express";
import {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getMyProducts,
  stockCheck,
  getSellerLowStock,
  getRelatedProducts,
  getStorefrontMeta,
} from "../controllers/productController.js";
import {
  listProductReviews,
  createOrUpdateReview,
  deleteReview,
  myProductReview,
  reviewEligibility,
} from "../controllers/reviewController.js";
import { protect, sellerOnly, optionalAuth } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";
import {
  createProductSchema,
  updateProductSchema,
} from "../validations/productSchemas.js";
import { z } from "zod";

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(2000).optional(),
});

const router = express.Router();

// Storefront metadata (brands + free-shipping threshold) — before /:id
router.get("/meta", getStorefrontMeta);

// GET /api/products — Public, cached via Redis
router.get("/", getProducts);

// GET /api/products/seller/my-products — Seller only, cached per seller
// MUST be defined before /:id to avoid Express matching "seller" as an :id param
router.get("/seller/my-products", protect, sellerOnly, getMyProducts);
router.get("/seller/low-stock", protect, sellerOnly, getSellerLowStock);

// POST /api/products/stock-check — Public
// MUST be defined before /:id to avoid Express matching "stock-check" as an :id param
// Returns live stock levels for a given list of product IDs.
// Not cached — always hits DB so the Cart page shows real-time stock.
router.post("/stock-check", stockCheck);

// Reviews
router.get("/:id/reviews", validateObjectIdParams("id"), listProductReviews);
router.get("/:id/reviews/mine", protect, validateObjectIdParams("id"), myProductReview);
router.get("/:id/reviews/eligibility", protect, validateObjectIdParams("id"), reviewEligibility);
router.post(
  "/:id/reviews",
  protect,
  validateObjectIdParams("id"),
  validate(reviewSchema),
  createOrUpdateReview,
);
router.delete(
  "/:id/reviews/:reviewId",
  protect,
  validateObjectIdParams("id", "reviewId"),
  deleteReview,
);

router.get("/:id/related", validateObjectIdParams("id"), getRelatedProducts);

// GET /api/products/:id — Public, cached via Redis
router.get("/:id", optionalAuth, validateObjectIdParams("id"), getProduct);

// POST /api/products — Seller only, Zod validates
router.post(
  "/",
  protect,
  sellerOnly,
  validate(createProductSchema),
  createProduct,
);

// PUT /api/products/:id — Seller only, Zod validates
router.put(
  "/:id",
  protect,
  sellerOnly,
  validateObjectIdParams("id"),
  validate(updateProductSchema),
  updateProduct,
);

// DELETE /api/products/:id — Seller only, invalidates cache
router.delete(
  "/:id",
  protect,
  sellerOnly,
  validateObjectIdParams("id"),
  deleteProduct,
);

export default router;
