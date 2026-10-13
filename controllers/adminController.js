import escapeStringRegexp from "escape-string-regexp"; // FIX #1
import sanitize from "mongo-sanitize"; // FIX #2
import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import { invalidateProductCache, cacheDel } from "../config/redis.js";
import {
  createVariants,
  replaceVariants,
  deactivateAllVariants,
  deleteAllVariants,
  syncProductSummary,
} from "../services/variantService.js";
import AuditLog from "../models/AuditLog.js";
import { recordAudit } from "../services/auditService.js";
import {
  deleteCloudinaryImages,
  removedImageUrls,
} from "../services/cloudinaryCleanupService.js";

// FIX #2: Explicit whitelist of product fields an admin may set
const ALLOWED_PRODUCT_FIELDS = [
  "name",
  "description",
  "price",
  "category",
  "brand",
  "stock",
  "image",
  "images",
  "isFeatured",
  "isActive",
  "hasVariants",
  "options",
  // Not a Product field — consumed separately by variantService below.
  "variants",
];

function pickProductFields(body) {
  const picked = {};
  for (const field of ALLOWED_PRODUCT_FIELDS) {
    if (body[field] !== undefined) {
      picked[field] = body[field];
    }
  }
  return sanitize(picked);
}

// FIX #2: Explicit whitelist of user fields an admin may update
function pickUserFields(body) {
  const { name, email, role } = body;
  return sanitize({ name, email, role });
}

export const getUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    // Soft-deleted accounts disappear from the directory entirely.
    const filter = { accountStatus: { $ne: "deleted" } };

    // FIX #1: Escape search before using in $regex to prevent ReDoS
    if (search && typeof search === "string") {
      const safe = escapeStringRegexp(search.slice(0, 100));
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
      ];
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const perPage = Math.min(50, Math.max(Number(limit) || 20, 1));
    const skip = (pageNum - 1) * perPage;

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select("-password")
      .skip(skip)
      .limit(perPage);

    res.json({
      users,
      total,
      page: pageNum,
      pages: Math.ceil(total / perPage),
    });
  } catch (error) {
    console.error("getUsers:", error);
    res.status(500).json({ message: "Failed to fetch users." });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const filter = {};
    if (req.query.action) filter.action = String(req.query.action).slice(0, 100);
    if (req.query.actor) filter.actor = req.query.actor;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort("-createdAt")
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return res.json({
      logs,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    console.error("getAuditLogs:", error);
    return res.status(500).json({ message: "Failed to fetch audit logs." });
  }
};

export const updateUserRole = async (req, res) => {
  try {
    // FIX #4: Validate role value — only allow known roles
    const VALID_ROLES = ["customer", "seller", "admin"];
    const { role } = req.body;

    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }

    const user = await User.findById(req.params.id);
    if (!user || user.accountStatus === "deleted") {
      return res.status(404).json({ message: "User not found" });
    }

    if (await wouldRemoveLastAdmin(user, role)) {
      return res
        .status(400)
        .json({ message: "Cannot demote the last admin account" });
    }

    const previousRole = user.role;
    user.role = role;
    await user.save();
    await recordAudit(
      req,
      "user.role-changed",
      { type: "User", id: user._id },
      { previousRole, newRole: role, userEmail: user.email },
    );

    res.json({
      message: "Role updated",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("updateUserRole:", error);
    res.status(500).json({ message: "Failed to update user role." });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const targetId = req.params.id;

    // An admin can never delete their own account through this endpoint.
    if (String(targetId) === String(req.user._id)) {
      return res
        .status(400)
        .json({ message: "You cannot delete your own account" });
    }

    const user = await User.findById(targetId);
    if (!user || user.accountStatus === "deleted") {
      return res.status(404).json({ message: "User not found" });
    }

    // Never remove the last remaining admin — the store would be locked
    // out of its own back office.
    if (user.role === "admin") {
      const adminCount = await User.countDocuments({
        role: "admin",
        accountStatus: { $ne: "deleted" },
      });
      if (adminCount <= 1) {
        return res
          .status(400)
          .json({ message: "Cannot delete the last admin account" });
      }
    }

    const deletedIdentity = { email: user.email, role: user.role };

    // Soft delete: keep orders/financial history intact, anonymise the
    // identity, and make the email address reusable for a fresh account.
    user.name = "Deleted user";
    user.email = `deleted-${user._id}@deleted.local`;
    user.password = awaitUserPasswordPlaceholder();
    user.otp = null;
    user.otpExpiresAt = null;
    user.otpAttempts = 0;
    user.passwordResetOtp = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpAttempts = 0;
    user.accountStatus = "deleted";
    user.deletedAt = new Date();
    user.deletedBy = req.user._id;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // A deleted seller's listings leave the storefront (they are kept in
    // the database so historical orders can still resolve their names),
    // and the account's cart can no longer be used.
    const sellerProducts = await Product.find(
      { seller: user._id },
      { _id: 1 },
    ).lean();
    await Product.updateMany(
      { seller: user._id },
      { $set: { isActive: false } },
    );
    await invalidateProductCache().catch(() => {});
    await cacheDel(
      `product:seller:${user._id}`,
      ...sellerProducts.map((product) => `product:single:${product._id}`),
    ).catch(() => {});
    await Cart.deleteMany({ user: user._id });
    await recordAudit(
      req,
      "user.deleted",
      { type: "User", id: user._id },
      deletedIdentity,
    );

    res.json({
      success: true,
      message:
        "User deleted. Their identity has been anonymised and any seller listings have been deactivated.",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

function awaitUserPasswordPlaceholder() {
  // Login is impossible anyway (address anonymised, status deleted); the
  // placeholder simply guarantees no old hash remains usable.
  return `deleted-${Date.now()}`;
}

async function wouldRemoveLastAdmin(user, nextRole) {
  if (!user || user.role !== "admin" || nextRole === "admin") return false;
  const adminCount = await User.countDocuments({
    role: "admin",
    accountStatus: { $ne: "deleted" },
  });
  return adminCount <= 1;
}

export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user || user.accountStatus === "deleted") {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error("getUser:", error);
    res.status(500).json({ message: "Failed to fetch user." });
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.accountStatus === "deleted") {
      return res.status(404).json({ message: "User not found" });
    }

    // FIX #2 + #4: Only allow known safe fields; validate role if provided
    const VALID_ROLES = ["customer", "seller", "admin"];
    const { name, email, role } = pickUserFields(req.body);

    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }

    if (role && (await wouldRemoveLastAdmin(user, role))) {
      return res
        .status(400)
        .json({ message: "Cannot demote the last admin account" });
    }

    const previous = { name: user.name, email: user.email, role: user.role };
    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;

    await user.save();
    if (role && role !== previous.role) {
      await recordAudit(
        req,
        "user.role-changed",
        { type: "User", id: user._id },
        { previousRole: previous.role, newRole: role, userEmail: user.email },
      );
    } else {
      await recordAudit(
        req,
        "user.updated",
        { type: "User", id: user._id },
        { previous, next: { name: user.name, email: user.email, role: user.role } },
      );
    }

    res.json({
      message: "User updated",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("updateUser:", error);
    res.status(500).json({ message: "Failed to update user." });
  }
};

export const getProductsByUser = async (req, res) => {
  try {
    const { search, page = 1, limit = 12 } = req.query;
    const filter = { seller: req.params.id };

    // FIX #1
    if (search && typeof search === "string") {
      const safe = escapeStringRegexp(search.slice(0, 100));
      filter.name = { $regex: safe, $options: "i" };
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const perPage = Math.min(50, Math.max(Number(limit) || 12, 1));
    const skip = (pageNum - 1) * perPage;

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .skip(skip)
      .limit(perPage)
      .populate("variants");

    res.json({
      products,
      total,
      page: pageNum,
      pages: Math.ceil(total / perPage),
    });
  } catch (error) {
    console.error("getProductsByUser:", error);
    res.status(500).json({ message: "Failed to fetch products." });
  }
};

export const createProductForUser = async (req, res) => {
  try {
    const { variants, ...picked } = pickProductFields(req.body);
    const payload = {
      ...picked,
      seller: req.params.id,
    };
    if (payload.images && payload.images.length > 0) {
      payload.image = payload.images[0];
    }
    const product = await Product.create(payload);

    try {
      if (product.hasVariants) {
        await createVariants(product, variants || []);
        await syncProductSummary(product._id);
      }
    } catch (variantError) {
      await deleteAllVariants(product._id);
      await Product.findByIdAndDelete(product._id);
      throw variantError;
    }

    // Invalidate cache so new product appears immediately
    await invalidateProductCache();

    const created = await Product.findById(product._id).populate("variants");
    res.status(201).json(created);
  } catch (error) {
    console.error("createProductForUser:", error);
    res.status(500).json({ message: "Failed to create product." });
  }
};

export const updateProductForUser = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const previousImageUrls = [product.image, ...(product.images || [])];
    const { variants, ...updatePayload } = pickProductFields(req.body);
    if (updatePayload.images && updatePayload.images.length > 0) {
      updatePayload.image = updatePayload.images[0];
    } else if (updatePayload.image) {
      updatePayload.images = [updatePayload.image];
    }

    const hasVariantsNow =
      updatePayload.hasVariants !== undefined
        ? updatePayload.hasVariants
        : product.hasVariants;

    if (hasVariantsNow && variants !== undefined) {
      await Product.findByIdAndUpdate(req.params.productId, updatePayload);
      const fresh = await Product.findById(req.params.productId);
      await replaceVariants(fresh, variants || []);
      await syncProductSummary(req.params.productId);
    } else if (updatePayload.hasVariants === false && product.hasVariants) {
      await deactivateAllVariants(req.params.productId);
      await Product.findByIdAndUpdate(req.params.productId, {
        ...updatePayload,
        variantCount: 0,
      });
    } else {
      await Product.findByIdAndUpdate(req.params.productId, updatePayload);
      if (hasVariantsNow) await syncProductSummary(req.params.productId);
    }

    const updated = await Product.findById(
      req.params.productId,
    ).populate("variants");

    if (
      updatePayload.image !== undefined ||
      updatePayload.images !== undefined
    ) {
      await deleteCloudinaryImages(
        removedImageUrls(previousImageUrls, [
          updated.image,
          ...(updated.images || []),
        ]),
        updated._id,
      );
    }

    // Invalidate list cache, single-product cache, and seller cache
    await invalidateProductCache();
    await cacheDel(
      `product:single:${req.params.productId}`,
      `product:seller:${product.seller}`,
    );

    res.json(updated);
  } catch (error) {
    console.error("updateProductForUser:", error);
    res.status(500).json({ message: "Failed to update product." });
  }
};

export const deleteProductForUser = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const imageUrls = [product.image, ...(product.images || [])];
    await deleteAllVariants(req.params.productId);
    await Product.findByIdAndDelete(req.params.productId);
    await deleteCloudinaryImages(imageUrls);

    // Invalidate list cache, single-product cache, and seller cache
    await invalidateProductCache();
    await cacheDel(
      `product:single:${req.params.productId}`,
      `product:seller:${product.seller}`,
    );

    res.json({ message: "Product deleted" });
  } catch (error) {
    console.error("deleteProductForUser:", error);
    res.status(500).json({ message: "Failed to delete product." });
  }
};

export const getOrdersByUser = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ user: req.params.id })
        .sort("-createdAt")
        .skip(skip)
        .limit(limit),
      Order.countDocuments({ user: req.params.id }),
    ]);

    res.json({ orders, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("getOrdersByUser:", error);
    res.status(500).json({ message: "Failed to fetch orders." });
  }
};

export const getSellerSalesByUser = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ "orderItems.seller": req.params.id })
        .populate("user", "name email")
        .sort("-createdAt")
        .skip(skip)
        .limit(limit),
      Order.countDocuments({ "orderItems.seller": req.params.id }),
    ]);

    res.json({ orders, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("getSellerSalesByUser:", error);
    res.status(500).json({ message: "Failed to fetch seller sales." });
  }
};
