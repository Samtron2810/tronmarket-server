import Product from "../models/Product.js";
import User from "../models/User.js";


export const getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("wishlist").lean();
    const ids = user?.wishlist || [];
    const products = await Product.find({ _id: { $in: ids }, isActive: true, moderationStatus: "approved" })
      .populate("seller", "name email role sellerVerified")
      .populate("variants")
      .lean();
    return res.json({ productIds: ids.map(String), products });
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
