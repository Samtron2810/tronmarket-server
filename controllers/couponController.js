import Cart from "../models/Cart.js";
import { evaluateCoupon } from "../services/couponService.js";
import { purchasablePrice } from "../services/variantService.js";

// Buyer-facing coupon preview: evaluates against the caller's cart subtotal
// (or an explicit subtotal) without redeeming anything.
export const validateCoupon = async (req, res) => {
  try {
    let subtotal = Number(req.body.itemsSubtotal);
    if (!Number.isFinite(subtotal)) {
      const cart = await Cart.findOne({ user: req.user._id })
        .populate("items.product")
        .populate("items.variant")
        .lean();
      subtotal = (cart?.items || []).reduce(
        (sum, item) => sum + purchasablePrice(item.product, item.variant) * Number(item.quantity || 0),
        0,
      );
    }
    const { coupon, discount } = await evaluateCoupon(req.body.code, subtotal);
    return res.json({
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount,
      itemsSubtotal: subtotal,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message });
  }
};
