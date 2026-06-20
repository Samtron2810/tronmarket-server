import express from "express";
import upload from "../middlewares/uploadMiddleware.js";
import cloudinary from "../config/cloudinary.js";
import { protect, sellerOnly } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * Upload a single buffer to Cloudinary.
 * Uses eager transformations so Cloudinary pre-generates WebP/AVIF on upload.
 */
const uploadBuffer = (buffer, fileName) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "tronmarket/products",
        resource_type: "image",
        // Eager transforms — generates optimized versions at upload time
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
        eager_async: false, // wait for eager transforms to complete
        // Sanitize the public_id to avoid special character issues
        public_id: fileName
          ? `product-${Date.now()}-${fileName.replace(/[^a-zA-Z0-9_-]/g, "")}`
          : undefined,
        // Image validation checks
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        max_file_size: 20 * 1024 * 1024, // 20MB (matches multer limit)
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(buffer);
  });
};

/**
 * POST /api/uploads — multipart form upload (images[])
 * Uploads files in PARALLEL for much faster total upload time.
 */
router.post(
  "/",
  protect,
  sellerOnly,
  upload.array("images"),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      // Upload all files in parallel
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

      // If all failed, return error
      if (urls.length === 0) {
        return res.status(500).json({
          message: "All uploads failed",
          errors,
        });
      }

      // If some failed, return partial success with warning
      const response = { urls };
      if (errors.length > 0) {
        response.warning = `${errors.length} file(s) failed to upload`;
        response.errors = errors;
      }

      res.json(response);
    } catch (error) {
      console.error("Upload error", error);
      res.status(500).json({ message: error.message });
    }
  },
);

export default router;
