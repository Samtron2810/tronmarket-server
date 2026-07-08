import Product from "../models/Product.js";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateProductCache,
  productCacheKey,
} from "../config/redis.js";

// ── CACHE TTL SETTINGS ──
// Reduce from 5 minutes to 1.5 minutes (90 seconds) so stock changes
// appear on the homepage quickly after orders complete.
const PRODUCT_LIST_CACHE_TTL = 90; // seconds
const SINGLE_PRODUCT_CACHE_TTL = 300; // 5 minutes (less critical)

export const createProduct = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      seller: req.user._id,
    };

    // if images array provided in body set images and primary image
    if (payload.images && payload.images.length > 0) {
      payload.image = payload.images[0];
    } else if (payload.image) {
      payload.images = [payload.image];
    }

    const product = await Product.create(payload);

    // Invalidate product cache so new product appears in listings
    await invalidateProductCache();

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

export const getProducts = async (req, res) => {
  try {
    const { search, category, min, max, page = 1, limit = 6 } = req.query;

    // Try to get from cache first
    // Cache key is based on all filter parameters so different searches
    // have separate cache entries
    const cacheKey = productCacheKey(req.query);
    const cached = await cacheGet(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    let filter = {};

    // SEARCH (name)
    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    // CATEGORY
    if (category) {
      filter.category = category;
    }

    // PRICE RANGE
    if (min || max) {
      filter.price = {};
      if (min) filter.price.$gte = Number(min);
      if (max) filter.price.$lte = Number(max);
    }

    // PAGINATION
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

    // Cache for 1.5 minutes so stock changes appear quickly after orders
    await cacheSet(cacheKey, result, PRODUCT_LIST_CACHE_TTL);

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Try single-product cache
    const cacheKey = `product:single:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    // Cache single product for 5 minutes
    await cacheSet(cacheKey, product, SINGLE_PRODUCT_CACHE_TTL);

    res.json(product);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

//allow only certain fields to be updated
const ALLOWED_FIELDS = [
  "name",
  "description",
  "price",
  "category",
  "brand",
  "stock",
  "image",
  "images",
];

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

    // Whitelist fields — don't spread raw req.body
    const updatePayload = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) updatePayload[field] = req.body[field];
    }

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
    res.status(500).json({ message: error.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    if (
      product.seller.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    // Invalidate cache
    await invalidateProductCache();
    await cacheDel(`product:single:${req.params.id}`);
    await cacheDel(`product:seller:${req.user._id}`);

    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

export const getMyProducts = async (req, res) => {
  try {
    // Seller's own products — cache per seller
    const cacheKey = `product:seller:${req.user._id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const products = await Product.find({ seller: req.user._id });

    // Cache for 2 minutes (seller dashboard needs fresh stock updates)
    await cacheSet(cacheKey, products, 120);

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc  Get current stock levels for a list of product IDs
// @route POST /api/products/stock-check
// @access Public
// Called by the frontend (Cart page AND Homepage product cards) to show
// live stock warnings / availability before the user attempts to add to cart
// or checkout. This endpoint is NOT cached — always hits the DB for real-time data.
// Body: { productIds: string[] }
// Returns: { stocks: { [productId]: number } }
export const stockCheck = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res
        .status(400)
        .json({ message: "productIds must be a non-empty array" });
    }

    // Fetch only _id and stock — no need for full product documents
    // Goes directly to DB (no cache) so we always get the freshest stock value
    const products = await Product.find(
      { _id: { $in: productIds } },
      { _id: 1, stock: 1 },
    ).lean();

    const stocks = {};
    products.forEach((p) => {
      stocks[p._id.toString()] = p.stock ?? 0;
    });

    res.json({ stocks });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
