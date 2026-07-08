import Cart from "../models/Cart.js";
import Product from "../models/Product.js";

export const addToCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // check stock
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const { quantity } = req.body;
    const qty = Number(quantity);

    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({ message: "Quantity must be at least 1" });
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.find(
      (item) => item.product.toString() === req.params.productId,
    );
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Stock validation — fetch the product to check current stock
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (product.stock <= 0) {
      return res.status(400).json({ message: "Product is out of stock" });
    }
    if (qty > product.stock) {
      return res
        .status(400)
        .json({ message: `Only ${product.stock} left in stock` });
    }

    item.quantity = qty;
    await cart.save();

    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
  }
};

// @desc  Validate all cart items against current stock levels
// @route POST /api/cart/validate
// @access Private
// Called by the frontend before placing an order to catch cases where
// another user bought the last item after this user added it to their cart.
// Returns { valid: boolean, errors: [{ productId, name, reason, availableStock, cartQuantity }] }
export const validateCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate(
      "items.product",
    );

    if (!cart || cart.items.length === 0) {
      return res.json({ valid: true, errors: [] });
    }

    const errors = [];

    for (const item of cart.items) {
      const product = item.product;

      // Product was deleted
      if (!product) {
        errors.push({
          productId: item.product,
          name: "Unknown product",
          reason: "out_of_stock",
          availableStock: 0,
          cartQuantity: item.quantity,
        });
        continue;
      }

      const available = product.stock ?? 0;
      const inCart = item.quantity;

      if (available === 0) {
        errors.push({
          productId: product._id,
          name: product.name,
          reason: "out_of_stock",
          availableStock: 0,
          cartQuantity: inCart,
        });
      } else if (available < inCart) {
        errors.push({
          productId: product._id,
          name: product.name,
          reason: "insufficient",
          availableStock: available,
          cartQuantity: inCart,
        });
      }
    }

    res.json({ valid: errors.length === 0, errors });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
