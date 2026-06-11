import express from "express";
import {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getMyProducts,
} from "../controllers/productController.js";
import { protect, sellerOnly } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getProducts);

router.get("/:id", getProduct);

router.post("/", protect, sellerOnly, createProduct);

router.put("/:id", protect, sellerOnly, updateProduct);

router.delete("/:id", protect, sellerOnly, deleteProduct);

router.get("/seller/my-products", protect, sellerOnly, getMyProducts);

export default router;
