import express from "express";
import upload from "../middlewares/uploadMiddleware.js";
import cloudinary from "../config/cloudinary.js";
import { protect, sellerOnly } from "../middlewares/authMiddleware.js";

const router = express.Router();

// POST /api/uploads - multipart form upload (images[])
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

      const uploaded = [];

      for (const file of req.files) {
        const result = await cloudinary.uploader.upload_stream(
          { folder: "tronmarket/products" },
          (error, result) => {
            // handled via stream promise below
          },
        );
        // since cloudinary.uploader.upload_stream uses callback, use a Promise wrapper
      }

      // simpler approach: upload from buffer using upload_stream with promise
      const uploadBuffer = (buffer) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "tronmarket/products" },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            },
          );
          stream.end(buffer);
        });
      };

      for (const file of req.files) {
        const resu = await uploadBuffer(file.buffer);
        uploaded.push(resu.secure_url);
      }

      res.json({ urls: uploaded });
    } catch (error) {
      console.error("Upload error", error);
      res.status(500).json({ message: error.message });
    }
  },
);

export default router;
