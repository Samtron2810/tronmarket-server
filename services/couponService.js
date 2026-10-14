import Coupon from "../models/Coupon.js";
import { money } from "./pricingService.js";

// Returns { coupon, discount } or throws an Error with statusCode.
export function couponError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function evaluateCoupon(code, itemsSubtotal) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) throw couponError("Enter a coupon code");

  const coupon = await Coupon.findOne({ code: clean });
  if (!coupon || !coupon.isActive) throw couponError("This coupon is not valid");
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw couponError("This coupon is not active yet");
  if (coupon.expiresAt && coupon.expiresAt < now) throw couponError("This coupon has expired");
  if (coupon.maxUsage > 0 && coupon.usedCount >= coupon.maxUsage) {
    throw couponError("This coupon has reached its usage limit");
  }
  const subtotal = money(itemsSubtotal);
  if (subtotal < money(coupon.minSubtotal)) {
    throw couponError(`This coupon needs an items subtotal of at least NGN ${money(coupon.minSubtotal).toLocaleString("en-NG")}`);
  }

  const discount =
    coupon.type === "percent"
      ? money((subtotal * Math.min(100, Math.max(0, coupon.value))) / 100)
      : money(Math.min(coupon.value, subtotal));

  return { coupon, discount };
}

export async function redeemCoupon(coupon) {
  if (!coupon) return;
  await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: 1 } });
}

export async function releaseCoupon(code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return;
  await Coupon.updateOne(
    { code: clean, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
  );
}
