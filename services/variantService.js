import Product from "../models/Product.js";
import ProductVariant from "../models/ProductVariant.js";

// ─── Product variant service ─────────────────────────────────────────────────
// The single place that knows how ProductVariant documents are built, how
// duplicate combinations are prevented, and how the derived summary fields
// on Product (price = min variant price, stock = total variant stock,
// variantCount) are maintained. Product, admin and order controllers must
// all go through here so no mutation path can forget the summary sync.

// "Colour=Black|Size=M" -> "colour=black|size=m" (sorted by option name so
// attribute order in the payload never creates false duplicates).
export function buildAttributeKey(attributes = []) {
  return attributes
    .map(
      (a) =>
        `${String(a.name).trim().toLowerCase()}=${String(a.value).trim().toLowerCase()}`,
    )
    .sort()
    .join("|");
}

// "Black / 256GB" — display snapshot stored on cart & order lines.
export function variantLabel(attributes = []) {
  return attributes.map((a) => String(a.value).trim()).join(" / ");
}

function autoSku(productId, attributeKey) {
  const slug = attributeKey
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .toUpperCase();
  return `TM-${String(productId).slice(-6).toUpperCase()}${slug ? `-${slug}` : ""}`;
}

function toVariantDoc(product, input) {
  const attributes = (input.attributes || []).map((a) => ({
    name: String(a.name).trim(),
    value: String(a.value).trim(),
  }));
  const attributeKey = buildAttributeKey(attributes);
  return {
    product: product._id,
    seller: product.seller,
    sku: input.sku?.trim() || autoSku(product._id, attributeKey),
    attributes,
    attributeKey,
    price: input.price ?? product.price ?? 0,
    stock: input.stock ?? 0,
    image: input.image || "",
    isActive: input.isActive !== false,
  };
}

// Create all variants for a newly created product. Throws on duplicate
// combinations (also backstopped by the unique index on ProductVariant).
export async function createVariants(product, variants = []) {
  const seen = new Set();
  const docs = variants.map((v) => {
    const doc = toVariantDoc(product, v);
    if (seen.has(doc.attributeKey)) {
      throw new Error(`Duplicate variant combination: ${variantLabel(doc.attributes)}`);
    }
    seen.add(doc.attributeKey);
    return doc;
  });
  if (docs.length > 0) await ProductVariant.insertMany(docs);
  return docs;
}

// Replace a product's variant set from an edit payload:
//  - inputs carrying an existing _id are updated in place (stock/price edits
//    must not break cart lines or order history pointing at them),
//  - inputs without _id are created,
//  - existing variants missing from the payload are DEACTIVATED, never
//    hard-deleted — carts/orders may still reference them.
export async function replaceVariants(product, variants = []) {
  const existing = await ProductVariant.find({ product: product._id });
  const existingById = new Map(existing.map((v) => [v._id.toString(), v]));
  const seenKeys = new Set();
  const keptIds = new Set();

  for (const input of variants) {
    const doc = toVariantDoc(product, input);
    if (seenKeys.has(doc.attributeKey)) {
      throw new Error(`Duplicate variant combination: ${variantLabel(doc.attributes)}`);
    }
    seenKeys.add(doc.attributeKey);

    const match = input._id ? existingById.get(String(input._id)) : null;
    if (match) {
      Object.assign(match, doc);
      await match.save();
      keptIds.add(match._id.toString());
    } else {
      // Also match by combination so a re-submitted new row reactivates
      // the deactivated variant instead of violating the unique index.
      const byKey = existing.find((v) => v.attributeKey === doc.attributeKey);
      if (byKey) {
        Object.assign(byKey, doc);
        await byKey.save();
        keptIds.add(byKey._id.toString());
      } else {
        const created = await ProductVariant.create(doc);
        keptIds.add(created._id.toString());
      }
    }
  }

  await ProductVariant.updateMany(
    { product: product._id, _id: { $nin: [...keptIds] } },
    { $set: { isActive: false } },
  );
}

export async function deactivateAllVariants(productId) {
  await ProductVariant.updateMany(
    { product: productId },
    { $set: { isActive: false } },
  );
}

export async function deleteAllVariants(productId) {
  await ProductVariant.deleteMany({ product: productId });
}

// Recompute Product.price / stock / variantCount from active variants.
// No-op summary (count 0, fields untouched) when the product has no active
// variants and doesn't claim to have any — legacy products keep their
// manually managed price/stock.
export async function syncProductSummary(productId) {
  const product = await Product.findById(productId);
  if (!product) return null;

  const [summary] = await ProductVariant.aggregate([
    { $match: { product: product._id, isActive: true } },
    {
      $group: {
        _id: null,
        minPrice: { $min: "$price" },
        totalStock: { $sum: "$stock" },
        count: { $sum: 1 },
      },
    },
  ]);

  product.variantCount = summary?.count ?? 0;
  if (product.hasVariants && summary) {
    product.price = summary.minPrice;
    product.stock = summary.totalStock;
  } else if (product.hasVariants) {
    product.stock = 0;
  }
  await product.save();
  return product;
}

// Resolve + validate the purchasable unit for a cart/order operation.
// Returns { variant } (null for legacy no-variant products) or throws an
// Error with a client-safe message.
export async function resolvePurchasable(product, variantId) {
  if (!product.hasVariants) return { variant: null };

  if (!variantId) {
    throw new Error("Please select a variant for this product");
  }
  const variant = await ProductVariant.findById(variantId);
  if (!variant || variant.product.toString() !== product._id.toString()) {
    throw new Error("Selected variant not found for this product");
  }
  if (!variant.isActive) {
    throw new Error("Selected variant is no longer available");
  }
  return { variant };
}

// Unit price/stock for a product or one of its variants (server-side truth —
// never trust prices sent by the client).
export function purchasablePrice(product, variant) {
  return variant ? variant.price : product.price;
}

export function purchasableStock(product, variant) {
  return variant ? variant.stock : product.stock;
}
