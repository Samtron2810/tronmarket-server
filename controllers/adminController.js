import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

export const getUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
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
    res.status(500).json({ message: error.message });
  }
};

export const updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
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
    res.status(500).json({ message: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    await user.remove();
    res.json({ message: "User deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { name, email, role } = req.body;
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
    res.status(500).json({ message: error.message });
  }
};

// Products on behalf of a user (seller)
export const getProductsByUser = async (req, res) => {
  try {
    const { search, page = 1, limit = 12 } = req.query;
    const filter = { seller: req.params.id };
    if (search) filter.name = { $regex: search, $options: "i" };

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
    res.status(500).json({ message: error.message });
  }
};

export const createProductForUser = async (req, res) => {
  try {
    const payload = { ...req.body, seller: req.params.id };
    if (payload.images && payload.images.length > 0)
      payload.image = payload.images[0];

    const product = await Product.create(payload);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProductForUser = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // allow admin to update regardless of seller
    const updatePayload = { ...req.body };
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
    res.status(500).json({ message: error.message });
  }
};

export const deleteProductForUser = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    await Product.findByIdAndDelete(req.params.productId);
    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getOrdersByUser = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.params.id }).populate(
      "items.product",
    );
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
