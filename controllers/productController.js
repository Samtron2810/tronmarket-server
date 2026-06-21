import Product from "../models/Product.js";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateProductCache,
  productCacheKey,
} from "../config/redis.js";

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

    // Cache for 5 minutes (300 seconds)
    await cacheSet(cacheKey, result, 300);

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

    // Cache single product for 10 minutes
    await cacheSet(cacheKey, product, 600);

    res.json(product);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

export const updateProduct = async (req, res) => {
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

    const updatePayload = { ...req.body };
    if (updatePayload.images && updatePayload.images.length > 0) {
      updatePayload.image = updatePayload.images[0];
    } else if (updatePayload.image) {
      updatePayload.images = [updatePayload.image];
    }

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updatePayload,
      {
        new: true,
      },
    );

    // Invalidate both list cache and single-product cache
    await invalidateProductCache();
    await cacheDel(`product:single:${req.params.id}`);

    res.json(updated);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
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

    // Cache for 5 minutes
    await cacheSet(cacheKey, products, 300);

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
