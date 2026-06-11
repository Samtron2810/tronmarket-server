import multer from "multer";

const storage = multer.memoryStorage();

// allow larger single-file sizes and more files
const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB per file
    files: 10,
  },
});

export default upload;
