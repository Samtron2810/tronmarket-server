import Cart from "../models/Cart.js";
import Product from "../models/Product.js";

export const addToCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (!product.stock || product.stock <= 0) {
      return res.status(400).json({ message: "Product is out of stock" });
    }

    const qty = Number(quantity) || 1;
    if (qty > product.stock) {
      return res
        .status(400)
        .json({ message: `Only ${product.stock} left in stock` });
    }

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    const existingItem = cart.items.find(
      (item) => item.product.toString() === productId,
    );

    if (existingItem) {
      const newQty = existingItem.quantity + qty;
      if (newQty > product.stock) {
        return res
          .status(400)
          .json({ message: `Only ${product.stock} left in stock` });
      }
      existingItem.quantity = newQty;
    } else {
      cart.items.push({ product: productId, quantity: qty });
    }

    await cart.save();

    res.status(200).json(cart);
  } catch (error) {
    console.error("addToCart:", error);
    res.status(500).json({ message: "Failed to add item to cart." });
  }
};

export const getCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate(
      "items.product",
    );

    if (!cart) {
      return res.json({ items: [] });
    }

    res.json(cart);
  } catch (error) {
    console.error("getCart:", error);
    res.status(500).json({ message: "Failed to fetch cart." });
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const { quantity } = req.body;

    // FIX #5: Validate quantity — must be a positive integer
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: "Quantity must be a positive whole number." });
    }

    // FIX #5: Check quantity against current stock
    const product = await Product.findById(req.params.productId).select(
      "stock",
    );
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (qty > product.stock) {
      return res.status(400).json({
        message: `Only ${product.stock} left in stock`,
      });
    }

    const cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.find(
      (item) => item.product.toString() === req.params.productId,
    );

    if (!item) {
      return res.status(404).json({ message: "Item not found in cart" });
    }

    item.quantity = qty;

    await cart.save();

    res.json(cart);
  } catch (error) {
    console.error("updateCartItem:", error);
    res.status(500).json({ message: "Failed to update cart item." });
  }
};

export const removeCartItem = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    cart.items = cart.items.filter(
      (item) => item.product.toString() !== req.params.productId,
    );

    await cart.save();

    res.json(cart);
  } catch (error) {
    console.error("removeCartItem:", error);
    res.status(500).json({ message: "Failed to remove cart item." });
  }
};

export const clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    cart.items = [];

    await cart.save();

    res.json({ message: "Cart cleared" });
  } catch (error) {
    console.error("clearCart:", error);
    res.status(500).json({ message: "Failed to clear cart." });
  }
};
