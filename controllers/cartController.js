import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import ProductVariant from "../models/ProductVariant.js";
import {
  resolvePurchasable,
  purchasableStock,
  variantLabel,
} from "../services/variantService.js";

// A cart line is product + variant. Legacy no-variant lines have
// variant === null and keep matching on product alone.
function lineMatches(item, productId, variantId) {
  if (item.product.toString() !== productId.toString()) return false;
  const itemVariant = item.variant ? item.variant.toString() : "";
  return itemVariant === (variantId ? variantId.toString() : "");
}

async function loadVariant(item) {
  if (!item.variant) return null;
  return ProductVariant.findById(item.variant);
}

export const addToCart = async (req, res) => {
  try {
    const { productId, variantId, quantity } = req.body;

    const product = await Product.findById(productId);

    if (!product || product.isActive === false) {
      return res.status(404).json({ message: "Product not found" });
    }

    let variant;
    try {
      ({ variant } = await resolvePurchasable(product, variantId));
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    const available = purchasableStock(product, variant);
    if (!available || available <= 0) {
      return res.status(400).json({ message: "Product is out of stock" });
    }

    // Quantities are validated by Zod on the route, but never trust that
    // alone: a negative or fractional quantity would corrupt order totals
    // and inflate stock at checkout.
    const qty = quantity === undefined ? 1 : Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: "Quantity must be a whole number of at least 1" });
    }
    if (qty > available) {
      return res
        .status(400)
        .json({ message: `Only ${available} left in stock` });
    }

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    const existingItem = cart.items.find((item) =>
      lineMatches(item, productId, variant?._id),
    );

    if (existingItem) {
      const newQty = existingItem.quantity + qty;
      if (newQty > available) {
        return res
          .status(400)
          .json({ message: `Only ${available} left in stock` });
      }
      existingItem.quantity = newQty;
    } else {
      cart.items.push({
        product: productId,
        variant: variant?._id ?? null,
        variantLabel: variant ? variantLabel(variant.attributes) : "",
        sku: variant?.sku ?? "",
        quantity: qty,
      });
    }

    await cart.save();

    res.status(200).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const mergeGuestCart = async (req, res) => {
  try {
    const guestItems = Array.isArray(req.body?.items) ? req.body.items : [];
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

    const merged = [];
    const skipped = [];

    for (const guestItem of guestItems) {
      const product = await Product.findById(guestItem.productId);
      if (!product || product.isActive === false) {
        skipped.push({ productId: guestItem.productId, reason: "unavailable" });
        continue;
      }

      let variant;
      try {
        ({ variant } = await resolvePurchasable(product, guestItem.variantId));
      } catch {
        skipped.push({ productId: guestItem.productId, reason: "unavailable" });
        continue;
      }

      const available = purchasableStock(product, variant);
      if (!available || available <= 0) {
        skipped.push({ productId: guestItem.productId, reason: "out_of_stock" });
        continue;
      }

      const existingItem = cart.items.find((item) =>
        lineMatches(item, guestItem.productId, variant?._id),
      );
      const desired = (existingItem?.quantity || 0) + guestItem.quantity;
      const quantity = Math.min(desired, available);

      if (existingItem) {
        existingItem.quantity = quantity;
      } else {
        cart.items.push({
          product: guestItem.productId,
          variant: variant?._id ?? null,
          variantLabel: variant ? variantLabel(variant.attributes) : "",
          sku: variant?.sku ?? "",
          quantity,
        });
      }

      merged.push({
        productId: guestItem.productId,
        variantId: variant?._id ?? null,
        quantity,
        capped: quantity < desired,
      });
    }

    await cart.save();
    const populated = await Cart.findById(cart._id)
      .populate("items.product")
      .populate("items.variant");

    return res.json({ cart: populated, merged, skipped });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id })
      .populate("items.product")
      .populate("items.variant");

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

    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: "Quantity must be a whole number of at least 1" });
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.find((i) =>
      lineMatches(i, req.params.productId, req.params.variantId),
    );
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Stock validation against the variant when the line has one.
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    const variant = await loadVariant(item);
    if (item.variant && (!variant || !variant.isActive)) {
      return res
        .status(400)
        .json({ message: "This variant is no longer available" });
    }
    const available = purchasableStock(product, variant);
    if (available <= 0) {
      return res.status(400).json({ message: "Product is out of stock" });
    }
    if (qty > available) {
      return res
        .status(400)
        .json({ message: `Only ${available} left in stock` });
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
      (item) => !lineMatches(item, req.params.productId, req.params.variantId),
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
// Stock is checked per variant for variant products.
// Returns { valid: boolean, errors: [{ productId, variantId, variantLabel, name, reason, availableStock, cartQuantity }] }
export const validateCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id })
      .populate("items.product")
      .populate("items.variant");

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
          variantId: item.variant ?? null,
          variantLabel: item.variantLabel || "",
          name: "Unknown product",
          reason: "out_of_stock",
          availableStock: 0,
          cartQuantity: item.quantity,
        });
        continue;
      }

      if (product.isActive === false) {
        errors.push({
          productId: product._id,
          variantId: item.variant?._id ?? null,
          variantLabel: item.variantLabel || "",
          name: product.name,
          reason: "unavailable",
          availableStock: 0,
          cartQuantity: item.quantity,
        });
        continue;
      }

      // Variant was deleted or deactivated after being added
      if (item.variant && (!item.variant.isActive || !item.variant.product)) {
        errors.push({
          productId: product._id,
          variantId: item.variant._id ?? item.variant,
          variantLabel: item.variantLabel || "",
          name: product.name,
          reason: "unavailable",
          availableStock: 0,
          cartQuantity: item.quantity,
        });
        continue;
      }
      if (product.hasVariants && !item.variant) {
        errors.push({
          productId: product._id,
          variantId: null,
          variantLabel: item.variantLabel || "",
          name: product.name,
          reason: "unavailable",
          availableStock: 0,
          cartQuantity: item.quantity,
        });
        continue;
      }

      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        errors.push({
          productId: product._id,
          variantId: item.variant?._id ?? null,
          variantLabel: item.variantLabel || "",
          name: product.name,
          reason: "invalid_quantity",
          availableStock: item.variant
            ? (item.variant.stock ?? 0)
            : (product.stock ?? 0),
          cartQuantity: item.quantity,
        });
        continue;
      }

      const available = item.variant
        ? (item.variant.stock ?? 0)
        : (product.stock ?? 0);
      const inCart = item.quantity;

      if (available === 0) {
        errors.push({
          productId: product._id,
          variantId: item.variant?._id ?? null,
          variantLabel: item.variantLabel || "",
          name: product.name,
          reason: "out_of_stock",
          availableStock: 0,
          cartQuantity: inCart,
        });
      } else if (available < inCart) {
        errors.push({
          productId: product._id,
          variantId: item.variant?._id ?? null,
          variantLabel: item.variantLabel || "",
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
