import express from "express";
import upload from "../middlewares/uploadMiddleware.js";
import cloudinary from "../config/cloudinary.js";
import { protect, sellerOnly } from "../middlewares/authMiddleware.js";
import { uploadLimiter } from "../middlewares/rateLimiter.js"; // FIX #6

const router = express.Router();

const uploadBuffer = (buffer, fileName) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "tronmarket/products",
        resource_type: "image",
        eager: [
          {
            width: 150,
            height: 150,
            crop: "fill",
            fetch_format: "auto",
            quality: "auto",
          },
          { width: 400, fetch_format: "auto", quality: "auto" },
          { width: 600, fetch_format: "auto", quality: "auto" },
        ],
        eager_async: false,
        public_id: fileName
          ? `product-${Date.now()}-${fileName.replace(/[^a-zA-Z0-9_-]/g, "")}`
          : undefined,
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        max_file_size: 20 * 1024 * 1024,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(buffer);
  });
};

// FIX #6: uploadLimiter added — 20 requests per 15 min per IP
router.post(
  "/",
  protect,
  sellerOnly,
  uploadLimiter,
  upload.array("images"),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const results = await Promise.allSettled(
        req.files.map((file) => uploadBuffer(file.buffer, file.originalname)),
      );

      const urls = [];
      const errors = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          urls.push(result.value.secure_url);
        } else {
          errors.push({
            file: req.files[index].originalname,
            error: result.reason.message || "Upload failed",
          });
        }
      });

      if (urls.length === 0) {
        return res.status(500).json({ message: "All uploads failed", errors });
      }

      const response = { urls };
      if (errors.length > 0) {
        response.warning = `${errors.length} file(s) failed to upload`;
        response.errors = errors;
      }

      res.json(response);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: "Upload failed. Please try again." });
    }
  },
);

export default router;
