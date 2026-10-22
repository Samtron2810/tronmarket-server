import Product from "../models/Product.js";
import User from "../models/User.js";
import { sendEmailSafe } from "../emails/emailService.js";
import { stockAlertEmail } from "../emails/templates/stockAlertEmail.js";

// A product at or below this many units is "low stock".
export const LOW_STOCK_THRESHOLD = 5;

// Decide whether a stock change deserves a seller alert and send it.
// Crossing-based (previous -> current), so a seller is emailed once when
// stock enters the low zone and once when it hits zero — not on every
// subsequent sale while already low. Restocking above the threshold
// naturally re-arms the alerts because the next downward crossing is a
// new transition.
//
// `previousStock` is the level before the change; `product` may be a
// product id, a lean doc, or a mongoose doc (its current `stock` is the
// level after the change).
export async function evaluateStockChange({ product, previousStock }) {
  try {
    const doc =
      product && typeof product === "object" && product.stock !== undefined
        ? product
        : await Product.findById(product).lean();
    if (!doc) return;

    const prev = Number(previousStock);
    const current = Number(doc.stock || 0);
    if (!Number.isFinite(prev)) return;

    let kind = null;
    if (prev > 0 && current <= 0) kind = "out";
    else if (prev > LOW_STOCK_THRESHOLD && current <= LOW_STOCK_THRESHOLD && current > 0) kind = "low";
    if (!kind) return;

    const seller = await User.findById(doc.seller)
      .select("email name isDeleted")
      .lean();
    if (!seller?.email || seller.isDeleted) return;

    await sendEmailSafe({
      to: seller.email,
      subject: kind === "out"
        ? `Out of stock: ${doc.name} — TronMarket`
        : `Low stock warning: ${doc.name} — TronMarket`,
      html: stockAlertEmail({ product: doc, kind }),
    });
  } catch (error) {
    console.error("Stock alert evaluation failed:", error?.message || error);
  }
}
