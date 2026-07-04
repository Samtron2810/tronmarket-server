import escapeStringRegexp from "escape-string-regexp"; // FIX #1
import sanitize from "mongo-sanitize"; // FIX #2
import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

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
    const filter = {};

    // FIX #1: Escape search before using in $regex to prevent ReDoS
    if (search && typeof search === "string") {
      const safe = escapeStringRegexp(search.slice(0, 100));
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
      ];
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const perPage = Math.max(Number(limit) || 20, 1);
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
    if (!user) return res.status(404).json({ message: "User not found" });

    user.role = role;
    await user.save();

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
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (error) {
    console.error("deleteUser:", error);
    res.status(500).json({ message: "Failed to delete user." });
  }
};

export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("getUser:", error);
    res.status(500).json({ message: "Failed to fetch user." });
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // FIX #2 + #4: Only allow known safe fields; validate role if provided
    const VALID_ROLES = ["customer", "seller", "admin"];
    const { name, email, role } = pickUserFields(req.body);

    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;

    await user.save();

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
    const perPage = Math.max(Number(limit) || 12, 1);
    const skip = (pageNum - 1) * perPage;

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter).skip(skip).limit(perPage);

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
    // FIX #2: whitelist + sanitize
    const payload = {
      ...pickProductFields(req.body),
      seller: req.params.id,
    };

    if (payload.images && payload.images.length > 0) {
      payload.image = payload.images[0];
    }

    const product = await Product.create(payload);
    res.status(201).json(product);
  } catch (error) {
    console.error("createProductForUser:", error);
    res.status(500).json({ message: "Failed to create product." });
  }
};

export const updateProductForUser = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // FIX #2: whitelist + sanitize — no raw body spreading into findByIdAndUpdate
    const updatePayload = pickProductFields(req.body);

    if (updatePayload.images && updatePayload.images.length > 0) {
      updatePayload.image = updatePayload.images[0];
    } else if (updatePayload.image) {
      updatePayload.images = [updatePayload.image];
    }

    const updated = await Product.findByIdAndUpdate(
      req.params.productId,
      updatePayload,
      { new: true },
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
    await Product.findByIdAndDelete(req.params.productId);
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
