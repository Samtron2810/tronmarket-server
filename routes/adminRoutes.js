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
import {
  createProductSchema,
  updateProductSchema,
} from "../validations/productSchemas.js";
import {
  getSellerApplications,
  reviewSellerApplication,
} from "../controllers/sellerApplicationController.js";
import { reviewSellerApplicationSchema } from "../validations/sellerApplicationSchemas.js";

const router = express.Router();

router.get("/users", protect, adminOnly, getUsers);

router.get(
  "/seller-applications",
  protect,
  adminOnly,
  getSellerApplications,
);
router.patch(
  "/seller-applications/:id",
  protect,
  adminOnly,
  validate(reviewSellerApplicationSchema),
  reviewSellerApplication,
);

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
router.post(
  "/users/:id/products",
  protect,
  adminOnly,
  validate(createProductSchema),
  createProductForUser,
);
router.put(
  "/users/:id/products/:productId",
  protect,
  adminOnly,
  validate(updateProductSchema),
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

// seller sales (orders containing this seller's products)
router.get("/users/:id/seller-sales", protect, adminOnly, getSellerSalesByUser);

export default router;
