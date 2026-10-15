import multer from "multer";

const storage = multer.memoryStorage();

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function imageFileFilter(req, file, cb) {
  if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    return cb(null, true);
  }
  const error = new Error("Only JPG, PNG, WebP or GIF images are allowed");
  error.statusCode = 400;
  return cb(error);
}

// Product imagery should be web-sized. Five files at 5 MB is ample for a
// listing and keeps a single request from tying up memory with huge buffers.
const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
    fields: 10,
    parts: 20,
  },
});

export function uploadProductImages(req, res, next) {
  upload.array("images", 5)(req, res, (error) => {
    if (!error) return next();
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Each image must be 5 MB or smaller"
        : error.code === "LIMIT_FILE_COUNT"
          ? "At most 5 images can be uploaded at once"
          : error.message || "Image upload failed";
    return res.status(400).json({ success: false, message });
  });
}

export default upload;
