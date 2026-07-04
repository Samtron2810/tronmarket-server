import express from "express";
import {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getMyProducts,
  stockCheck,
} from "../controllers/productController.js";
import { protect, sellerOnly } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  createProductSchema,
  updateProductSchema,
} from "../validations/productSchemas.js";

const router = express.Router();

// GET /api/products — Public, cached via Redis
router.get("/", getProducts);

// GET /api/products/seller/my-products — Seller only, cached per seller
// MUST be defined before /:id to avoid Express matching "seller" as an :id param
router.get("/seller/my-products", protect, sellerOnly, getMyProducts);

// POST /api/products/stock-check — Public
// MUST be defined before /:id to avoid Express matching "stock-check" as an :id param
// Returns live stock levels for a given list of product IDs.
// Not cached — always hits DB so the Cart page shows real-time stock.
router.post("/stock-check", stockCheck);

// GET /api/products/:id — Public, cached via Redis
router.get("/:id", getProduct);

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
  validate(updateProductSchema),
  updateProduct,
);

// DELETE /api/products/:id — Seller only, invalidates cache
router.delete("/:id", protect, sellerOnly, deleteProduct);

export default router;
