// Who may review a product: a buyer whose package containing that product has
// been delivered (or completed). Cancelled packages don't count. Used to gate
// posting and to tell the storefront whether to show the review form.
import Order from "../models/Order.js";
import { SETTLEABLE } from "./payoutLedgerService.js";

const id = (value) => (value && value._id ? String(value._id) : String(value || ""));

export async function canReviewProduct(userId, productId) {
  if (!userId || !productId) return false;
  const orders = await Order.find({
    user: userId,
    "orderItems.product": productId,
    "sellerFulfillments.status": { $in: SETTLEABLE },
  })
    .select("orderItems sellerFulfillments")
    .lean();

  return orders.some((order) => {
    const packages = order.sellerFulfillments || [];
    return (order.orderItems || []).some((line) => {
      const sellerId = id(line.seller);
      return (
        id(line.product) === String(productId) &&
        Boolean(sellerId) &&
        packages.some((pkg) => id(pkg.seller) === sellerId && SETTLEABLE.includes(pkg.status))
      );
    });
  });
}
