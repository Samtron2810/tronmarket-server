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
  getAuditLogs,
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
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

const router = express.Router();

router.get("/users", protect, adminOnly, getUsers);
router.get("/audit-logs", protect, adminOnly, getAuditLogs);

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
  validateObjectIdParams("id"),
  validate(reviewSellerApplicationSchema),
  reviewSellerApplication,
);

// FIX #4: Zod validation on role and user update routes
router.put(
  "/users/:id/role",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  validate(updateRoleSchema),
  updateUserRole,
);
router.delete(
  "/users/:id",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  deleteUser,
);

router.get(
  "/users/:id",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  getUser,
);
router.put(
  "/users/:id",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  validate(updateUserSchema),
  updateUser,
);

router.get(
  "/users/:id/products",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  getProductsByUser,
);
router.post(
  "/users/:id/products",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  validate(createProductSchema),
  createProductForUser,
);
router.put(
  "/users/:id/products/:productId",
  protect,
  adminOnly,
  validateObjectIdParams("id", "productId"),
  validate(updateProductSchema),
  updateProductForUser,
);
router.delete(
  "/users/:id/products/:productId",
  protect,
  adminOnly,
  validateObjectIdParams("id", "productId"),
  deleteProductForUser,
);

router.get(
  "/users/:id/orders",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  getOrdersByUser,
);
// Seller sales: orders containing this seller's products. Registered once.
router.get(
  "/users/:id/seller-sales",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  getSellerSalesByUser,
);

export default router;
