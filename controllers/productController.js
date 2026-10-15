import mongoose from "mongoose";
import escapeStringRegexp from "escape-string-regexp";
import Product from "../models/Product.js";
import ProductVariant from "../models/ProductVariant.js";
import {
  createVariants,
  replaceVariants,
  deactivateAllVariants,
  deleteAllVariants,
  syncProductSummary,
} from "../services/variantService.js";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateProductCache,
  productCacheKey,
} from "../config/redis.js";
import {
  deleteCloudinaryImages,
  removedImageUrls,
} from "../services/cloudinaryCleanupService.js";

// ── CACHE TTL SETTINGS ──
// Reduce from 5 minutes to 1.5 minutes (90 seconds) so stock changes
// appear on the homepage quickly after orders complete.
const PRODUCT_LIST_CACHE_TTL = 90; // seconds
const SINGLE_PRODUCT_CACHE_TTL = 300; // 5 minutes (less critical)

export const createProduct = async (req, res) => {
  try {
    const { variants, ...rest } = req.body;
    const payload = {
      ...rest,
      seller: req.user._id,
      // Featuring is an admin merchandising decision. A seller-supplied
      // isFeatured flag is ignored rather than allowed to self-promote.
      isFeatured: req.user.role === "admin" ? Boolean(rest.isFeatured) : false,
      // New seller listings enter the moderation queue; admin listings and
      // drafts are handled directly.
      isDraft: Boolean(rest.isDraft),
      isActive: rest.isDraft ? false : rest.isActive !== false,
      moderationStatus: req.user.role === "admin" ? "approved" : "pending",
    };

    // if images array provided in body set images and primary image
    if (payload.images && payload.images.length > 0) {
      payload.image = payload.images[0];
    } else if (payload.image) {
      payload.images = [payload.image];
    }

    const product = await Product.create(payload);

    try {
      if (product.hasVariants) {
        await createVariants(product, variants || []);
        await syncProductSummary(product._id);
      }
    } catch (variantError) {
      // Roll back the half-created product so a bad variant payload
      // never leaves an orphan listing behind.
      await deleteAllVariants(product._id);
      await Product.findByIdAndDelete(product._id);
      throw variantError;
    }

    // Invalidate product cache so new product appears in listings
    await invalidateProductCache();

    const created = await Product.findById(product._id).populate("variants");
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

/**
 * GET /api/products/meta — public storefront metadata:
 * distinct brands (for filters) + the free-shipping threshold (for the
 * cart progress bar). Mirrors the storefront visibility rules.
 */
export const getStorefrontMeta = async (req, res) => {
  try {
    const visibility = {
      isActive: { $ne: false },
      isDraft: { $ne: true },
      $or: [
        { moderationStatus: "approved" },
        { moderationStatus: { $exists: false } },
      ],
    };
    const brands = await Product.distinct("brand", {
      ...visibility,
      brand: { $exists: true, $nin: [null, ""] },
    });
    const categories = await Product.distinct("category", {
      ...visibility,
      category: { $exists: true, $nin: [null, ""] },
    });
    const { getFreeShippingThreshold } = await import("../services/pricingService.js");
    return res.json({
      brands: brands.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
      categories: categories.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
      freeShippingThreshold: getFreeShippingThreshold(),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getProducts = async (req, res) => {
  try {
    const { search, category, brand, featured, seller, sort, min, max, page = 1, limit = 6 } = req.query;

    // Try to get from cache first
    // Cache key is based on all filter parameters so different searches
    // have separate cache entries
    const cacheKey = productCacheKey(req.query);
    const cached = await cacheGet(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    // Storefront only ever shows active, published, moderation-cleared
    // listings (drafts, paused listings, pending/rejected moderation and
    // deactivated products stay hidden).
    let filter = {
      isActive: { $ne: false },
      isDraft: { $ne: true },
      // "approved" plus legacy documents that predate moderation (no field).
      $and: [
        {
          $or: [
            { moderationStatus: "approved" },
            { moderationStatus: { $exists: false } },
          ],
        },
      ],
    };

    // SEARCH across name/brand/category/description — user input is escaped
    // before it goes anywhere near a regex, so patterns like ((a+)+$ can
    // neither ReDoS nor 500 us. The text index covers the same fields.
    if (search && typeof search === "string") {
      const safe = escapeStringRegexp(search.trim().slice(0, 100));
      if (safe) {
        const rx = { $regex: safe, $options: "i" };
        filter.$or = [{ name: rx }, { brand: rx }, { category: rx }, { description: rx }];
      }
    }

    // CATEGORY — exact match, but tolerant of the capitalisation used by
    // managed categories vs. older product records.
    if (category && typeof category === "string") {
      const cleanCategory = category.trim().slice(0, 100);
      if (cleanCategory) {
        filter.category = {
          $regex: `^${escapeStringRegexp(cleanCategory)}$`,
          $options: "i",
        };
      }
    }

    if (brand && typeof brand === "string") {
      filter.brand = { $regex: `^${escapeStringRegexp(brand.trim().slice(0, 100))}$`, $options: "i" };
    }

    if (featured === "1" || featured === "true") {
      filter.isFeatured = true;
    }

    // SELLER — "more from this seller" on the product page
    if (seller && typeof seller === "string" && /^[a-fA-F0-9]{24}$/.test(seller)) {
      filter.seller = seller;
    }

    // PRICE RANGE
    const minPrice = Number(min);
    const maxPrice = Number(max);
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      filter.price = {};
      if (Number.isFinite(minPrice)) {
        filter.price.$gte = Math.max(0, minPrice);
      }
      if (Number.isFinite(maxPrice)) {
        filter.price.$lte = Math.max(0, maxPrice);
      }
    }

    // PAGINATION — page size is always bounded.
    const pageNum = Math.min(10000, Math.max(Number(page) || 1, 1));
    const perPage = Math.min(50, Math.max(Number(limit) || 6, 1));
    const skip = (pageNum - 1) * perPage;

    const sortMap = {
      newest: { createdAt: -1 },
      "price-asc": { price: 1 },
      "price-desc": { price: -1 },
      name: { name: 1 },
      rating: { rating: -1 },
    };
    const sortSpec = sortMap[sort] || { createdAt: -1 };

    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(perPage)
      .populate("seller", "name email role sellerVerified");

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
      const ownerCached =
        req.user &&
        (req.user.role === "admin" || String(cached.seller?._id || cached.seller) === String(req.user._id));
      if (!ownerCached && (cached.isDraft || cached.moderationStatus === "pending" || cached.moderationStatus === "rejected")) {
        return res.status(404).json({ message: "Product not found" });
      }
      return res.json(cached);
    }

    const product = await Product.findById(id)
      .populate("variants")
      .populate("seller", "name email role sellerVerified");

    if (!product || product.isActive === false) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    const isOwnerOrAdmin =
      req.user &&
      (req.user.role === "admin" || String(product.seller?._id || product.seller) === String(req.user._id));
    if (!isOwnerOrAdmin && (product.isDraft || product.moderationStatus === "pending" || product.moderationStatus === "rejected")) {
      return res.status(404).json({ message: "Product not found" });
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
  "hasVariants",
  "options",
  "isDraft",
  "isActive",
  "discountPercent",
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

    const previousImageUrls = [product.image, ...(product.images || [])];

    // Whitelist fields — don't spread raw req.body. isFeatured is kept out
    // of ALLOWED_FIELDS and only an admin may change it.
    const updatePayload = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) updatePayload[field] = req.body[field];
    }
    if (req.user.role === "admin" && req.body.isFeatured !== undefined) {
      updatePayload.isFeatured = Boolean(req.body.isFeatured);
    }

    if (updatePayload.images && updatePayload.images.length > 0) {
      updatePayload.image = updatePayload.images[0];
    } else if (updatePayload.image) {
      updatePayload.images = [updatePayload.image];
    }

    const hasVariantsNow =
      updatePayload.hasVariants !== undefined
        ? updatePayload.hasVariants
        : product.hasVariants;

    if (hasVariantsNow && req.body.variants !== undefined) {
      // Variants must exist before syncProductSummary can derive the
      // product's price/stock from them.
      await Product.findByIdAndUpdate(req.params.id, updatePayload);
      const fresh = await Product.findById(req.params.id);
      await replaceVariants(fresh, req.body.variants || []);
      await syncProductSummary(req.params.id);
    } else if (updatePayload.hasVariants === false && product.hasVariants) {
      // Switching variants off: deactivate variants, payload price/stock
      // become authoritative again.
      await deactivateAllVariants(req.params.id);
      await Product.findByIdAndUpdate(req.params.id, {
        ...updatePayload,
        variantCount: 0,
      });
    } else {
      await Product.findByIdAndUpdate(req.params.id, updatePayload);
      if (hasVariantsNow) await syncProductSummary(req.params.id);
    }

    if (req.user.role !== "admin") {
      const freshDoc = await Product.findById(req.params.id);
      if (freshDoc) {
        let changed = false;
        if (freshDoc.isDraft) freshDoc.isActive = false;
        if (freshDoc.moderationStatus === "rejected") { freshDoc.moderationStatus = "pending"; changed = true; }
        if (updatePayload.isDraft === false && freshDoc.moderationStatus !== "approved") { freshDoc.moderationStatus = "pending"; changed = true; }
        if (changed || freshDoc.isDraft) await freshDoc.save();
      }
    }

    const updated = await Product.findById(req.params.id).populate("variants");

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

    const imageUrls = [product.image, ...(product.images || [])];
    await deleteAllVariants(req.params.id);
    await Product.findByIdAndDelete(req.params.id);
    await deleteCloudinaryImages(imageUrls);

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
// Returns: {
//   stocks:   { [productId]: number },                    // total (legacy shape, kept)
//   variants: { [productId]: { [variantId]: number } }    // per-variant stock
// }
export const stockCheck = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res
        .status(400)
        .json({ message: "productIds must be a non-empty array" });
    }
    if (productIds.length > 50) {
      return res.status(400).json({
        message: "productIds is limited to 50 items per request",
      });
    }

    // Dedupe and drop anything that isn't a valid ObjectId before querying.
    const uniqueIds = [
      ...new Set(productIds.map((id) => String(id))),
    ].filter((id) => mongoose.isValidObjectId(id));

    // Fetch only _id, stock and hasVariants — goes directly to DB (no
    // cache) so we always get the freshest stock values.
    const products = await Product.find(
      { _id: { $in: uniqueIds }, isActive: { $ne: false } },
      { _id: 1, stock: 1, hasVariants: 1 },
    ).lean();

    const stocks = {};
    products.forEach((p) => {
      stocks[p._id.toString()] = p.stock ?? 0;
    });

    const variantProducts = products.filter((p) => p.hasVariants);
    const variants = {};
    if (variantProducts.length > 0) {
      const variantDocs = await ProductVariant.find(
        {
          product: { $in: variantProducts.map((p) => p._id) },
          isActive: true,
        },
        { _id: 1, product: 1, stock: 1 },
      ).lean();

      for (const v of variantDocs) {
        const pid = v.product.toString();
        if (!variants[pid]) variants[pid] = {};
        variants[pid][v._id.toString()] = v.stock ?? 0;
      }
      // Totals for variant products are the sum of ACTIVE variant stock,
      // which may differ from the stored summary between syncs.
      for (const p of variantProducts) {
        const byVariant = variants[p._id.toString()] || {};
        stocks[p._id.toString()] = Object.values(byVariant).reduce(
          (a, b) => a + b,
          0,
        );
      }
    }

    res.json({ stocks, variants });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Low-stock list for the signed-in seller (countInStock <= threshold).
export const getSellerLowStock = async (req, res) => {
  try {
    const threshold = Math.min(100, Math.max(1, Number(req.query.threshold) || 5));
    const products = await Product.find({
      seller: req.user._id,
      isActive: { $ne: false },
      countInStock: { $lte: threshold },
    })
      .sort({ countInStock: 1 })
      .populate("variants")
      .lean();
    return res.json({ threshold, products });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load low-stock products" });
  }
};

// Related products: same category first, then same brand.
export const getRelatedProducts = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select("category brand").lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    const base = { _id: { $ne: req.params.id }, isActive: { $ne: false }, isDraft: { $ne: true }, $or: [{ moderationStatus: "approved" }, { moderationStatus: { $exists: false } }] };
    const [sameCategory, sameBrand] = await Promise.all([
      Product.find({ ...base, category: product.category }).limit(6).populate("seller", "name sellerVerified").populate("variants").lean(),
      Product.find({ ...base, brand: product.brand, category: { $ne: product.category } }).limit(3).populate("seller", "name sellerVerified").populate("variants").lean(),
    ]);
    const seen = new Set();
    const related = [...sameCategory, ...sameBrand].filter((p) => {
      if (seen.has(String(p._id))) return false;
      seen.add(String(p._id));
      return true;
    }).slice(0, 8);
    return res.json(related);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load related products" });
  }
};
