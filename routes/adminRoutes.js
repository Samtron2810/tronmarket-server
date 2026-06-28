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
import { validate } from "../middlewares/validate.js";
import {
  updateRoleSchema,
  updateUserSchema,
} from "../validations/adminSchemas.js"; // FIX #4

const router = express.Router();

router.get("/users", protect, adminOnly, getUsers);

// FIX #4: Zod validation on role and user update routes
router.put(
  "/users/:id/role",
  protect,
  adminOnly,
  validate(updateRoleSchema),
  updateUserRole,
);
router.delete("/users/:id", protect, adminOnly, deleteUser);

router.get("/users/:id", protect, adminOnly, getUser);
router.put(
  "/users/:id",
  protect,
  adminOnly,
  validate(updateUserSchema),
  updateUser,
);

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

router.get("/users/:id/orders", protect, adminOnly, getOrdersByUser);
router.get("/users/:id/seller-sales", protect, adminOnly, getSellerSalesByUser);

export default router;
