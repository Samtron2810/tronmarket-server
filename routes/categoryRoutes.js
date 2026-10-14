import express from "express";
import { listCategories } from "../controllers/categoryController.js";
import { optionalAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.get("/", optionalAuth, listCategories);

export default router;
