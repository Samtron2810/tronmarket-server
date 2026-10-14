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
import {
  getAnalytics,
  moderationQueue,
  moderateProduct,
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listReturns,
  reviewReturn,
  refundQueue,
  exportOrdersCsv,
  exportProductsCsv,
  exportUsersCsv,
  bulkProducts,
  setSellerVerified,
} from "../controllers/adminOpsController.js";
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import {
  createCouponSchema,
  updateCouponSchema,
} from "../validations/couponSchemas.js";
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


router.get("/analytics", protect, adminOnly, getAnalytics);

// Seller verification badge
router.patch(
  "/users/:id/seller-verified",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  setSellerVerified,
);

// Product moderation
router.get("/moderation", protect, adminOnly, moderationQueue);
router.patch(
  "/moderation/:id",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  moderateProduct,
);

// Coupons
router.get("/coupons", protect, adminOnly, listCoupons);
router.post("/coupons", protect, adminOnly, validate(createCouponSchema), createCoupon);
router.put(
  "/coupons/:id",
  protect,
  adminOnly,
  validateObjectIdParams("id"),
  validate(updateCouponSchema),
  updateCoupon,
);
router.delete("/coupons/:id", protect, adminOnly, validateObjectIdParams("id"), deleteCoupon);

// Categories
router.post("/categories", protect, adminOnly, createCategory);
router.put("/categories/:id", protect, adminOnly, validateObjectIdParams("id"), updateCategory);
router.delete("/categories/:id", protect, adminOnly, validateObjectIdParams("id"), deleteCategory);

// Returns & refund queue
router.get("/returns", protect, adminOnly, listReturns);
router.patch("/returns/:id", protect, adminOnly, validateObjectIdParams("id"), reviewReturn);
router.get("/refunds", protect, adminOnly, refundQueue);

// CSV exports
router.get("/exports/orders.csv", protect, adminOnly, exportOrdersCsv);
router.get("/exports/products.csv", protect, adminOnly, exportProductsCsv);
router.get("/exports/users.csv", protect, adminOnly, exportUsersCsv);

// Bulk product actions
router.post("/products/bulk", protect, adminOnly, bulkProducts);

export default router;

