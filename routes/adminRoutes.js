import express from "express";
import {
  getUsers,
  updateUserRole,
  deleteUser,
  getUser,
  updateUser,
  getProductsByUser,
  createProductForUser,
  updateProductForUser,
  deleteProductForUser,
  getOrdersByUser,
  getSellerSalesByUser,
} from "../controllers/adminController.js";
import { protect, adminOnly } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/users", protect, adminOnly, getUsers);
router.put("/users/:id/role", protect, adminOnly, updateUserRole);
router.delete("/users/:id", protect, adminOnly, deleteUser);

// user management
router.get("/users/:id", protect, adminOnly, getUser);
router.put("/users/:id", protect, adminOnly, updateUser);

// manage a user's products (admin on behalf of seller)
router.get("/users/:id/products", protect, adminOnly, getProductsByUser);
router.post("/users/:id/products", protect, adminOnly, createProductForUser);
router.put(
  "/users/:id/products/:productId",
  protect,
  adminOnly,
  updateProductForUser,
);
router.delete(
  "/users/:id/products/:productId",
  protect,
  adminOnly,
  deleteProductForUser,
);

// user orders (orders placed BY this user)
router.get("/users/:id/orders", protect, adminOnly, getOrdersByUser);

// seller sales (orders containing this seller's products)
router.get("/users/:id/seller-sales", protect, adminOnly, getSellerSalesByUser);

export default router;
