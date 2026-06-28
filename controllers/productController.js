import escapeStringRegexp from "escape-string-regexp"; // FIX #1: ReDoS prevention
import sanitize from "mongo-sanitize"; // FIX #2: operator injection
import Product from "../models/Product.js";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateProductCache,
  productCacheKey,
} from "../config/redis.js";

// Allowed fields for create/update — prevents prototype pollution & field injection
// FIX #2: explicit whitelist instead of spreading raw req.body
const ALLOWED_PRODUCT_FIELDS = [
  "name",
  "description",
  "price",
  "category",
  "brand",
  "stock",
  "image",
  "images",
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

export const createProduct = async (req, res) => {
  try {
    const payload = {
      ...pickProductFields(req.body), // FIX #2: whitelist + sanitize
      seller: req.user._id,
    };

    if (payload.images && payload.images.length > 0) {
      payload.image = payload.images[0];
    } else if (payload.image) {
      payload.images = [payload.image];
    }

    const product = await Product.create(payload);

    await invalidateProductCache();

    res.status(201).json(product);
  } catch (error) {
    // FIX #7: log real error, return safe message
    console.error("createProduct:", error);
    res.status(500).json({ message: "Failed to create product." });
  }
};

export const getProducts = async (req, res) => {
  try {
    const { search, category, min, max, page = 1, limit = 6 } = req.query;

    const cacheKey = productCacheKey(req.query);
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let filter = {};

    // FIX #1: Escape search string to prevent ReDoS and regex injection.
    // Also enforce a max length so the regex engine can't be fed huge input.
    if (search && typeof search === "string") {
      const safe = escapeStringRegexp(search.slice(0, 100));
      filter.name = { $regex: safe, $options: "i" };
    }

    if (category && typeof category === "string") {
      filter.category = sanitize(category); // FIX #2
    }

    if (min || max) {
      filter.price = {};
      if (min) filter.price.$gte = Number(min);
      if (max) filter.price.$lte = Number(max);
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const perPage = Math.max(Number(limit) || 6, 1);
    const skip = (pageNum - 1) * perPage;

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter).skip(skip).limit(perPage);

    const result = {
      products,
      total,
      page: pageNum,
      pages: Math.ceil(total / perPage),
    };

    await cacheSet(cacheKey, result, 300);

    res.json(result);
  } catch (error) {
    console.error("getProducts:", error);
    res.status(500).json({ message: "Failed to fetch products." });
  }
};

export const getProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const cacheKey = `product:single:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await cacheSet(cacheKey, product, 600);

    res.json(product);
  } catch (error) {
    console.error("getProduct:", error);
    res.status(500).json({ message: "Failed to fetch product." });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (
      product.seller.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // FIX #2: whitelist + sanitize — no raw body spreading into Mongoose
    const updatePayload = pickProductFields(req.body);

    if (updatePayload.images && updatePayload.images.length > 0) {
      updatePayload.image = updatePayload.images[0];
    } else if (updatePayload.image) {
      updatePayload.images = [updatePayload.image];
    }

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updatePayload,
      { new: true },
    );

    await invalidateProductCache();
    await cacheDel(`product:single:${req.params.id}`);
    await cacheDel(`product:seller:${req.user._id}`);

    res.json(updated);
  } catch (error) {
    console.error("updateProduct:", error);
    res.status(500).json({ message: "Failed to update product." });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (
      product.seller.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await Product.findByIdAndDelete(req.params.id);

    await invalidateProductCache();
    await cacheDel(`product:single:${req.params.id}`);
    await cacheDel(`product:seller:${req.user._id}`);

    res.json({ message: "Product deleted" });
  } catch (error) {
    console.error("deleteProduct:", error);
    res.status(500).json({ message: "Failed to delete product." });
  }
};

export const getMyProducts = async (req, res) => {
  try {
    const cacheKey = `product:seller:${req.user._id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const products = await Product.find({ seller: req.user._id });

    await cacheSet(cacheKey, products, 300);

    res.json(products);
  } catch (error) {
    console.error("getMyProducts:", error);
    res.status(500).json({ message: "Failed to fetch your products." });
  }
};
