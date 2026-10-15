import express from "express";
import { getWishlist, toggleWishlist } from "../controllers/wishlistController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { validateObjectIdParams } from "../middlewares/validateObjectId.js";

const router = express.Router();
router.get("/", protect, getWishlist);
router.post("/:productId/toggle", protect, validateObjectIdParams("productId"), toggleWishlist);

export default router;
