import Product from "../models/Product.js";
import User from "../models/User.js";


export const getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("wishlist").lean();
    const ids = user?.wishlist || [];
    // Visibility must match the storefront: a product counts as visible when
    // it is not deactivated/drafted and is moderation-approved — including
    // legacy documents saved before moderationStatus existed (no field at
    // all). A strict { moderationStatus: "approved" } here silently drops
    // those products even though their ids are saved (heart shows filled,
    // wishlist page renders empty).
    const products = await Product.find({
      _id: { $in: ids },
      isActive: { $ne: false },
      isDraft: { $ne: true },
      $or: [
        { moderationStatus: "approved" },
        { moderationStatus: { $exists: false } },
      ],
    })
      .populate("seller", "name email role sellerVerified")
      .populate("variants")
      .lean();
    // Preserve the order the buyer saved them in (most recent last saved
    // stays where they left it), not Mongo's natural order.
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);
    return res.json({ productIds: ids.map(String), products: ordered });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load wishlist" });
  }
};

export const toggleWishlist = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).select("_id").lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    const user = await User.findById(req.user._id).select("wishlist");
    const has = (user.wishlist || []).some((id) => String(id) === String(product._id));
    if (has) {
      user.wishlist = user.wishlist.filter((id) => String(id) !== String(product._id));
    } else {
      user.wishlist = [...(user.wishlist || []), product._id];
    }
    await user.save();
    return res.json({ saved: !has, productIds: user.wishlist.map(String) });
  } catch (error) {
    return res.status(500).json({ message: "Could not update wishlist" });
  }
};
