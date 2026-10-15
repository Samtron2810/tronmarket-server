import { v2 as cloudinary } from "cloudinary";
import Product from "../models/Product.js";

// Deletes Cloudinary images that no product references any more.
// DRY-RUN by default: set IMAGE_CLEANUP_APPLY=1 to actually delete.
// Only touches the tronmarket-uploads folder.

const FOLDER = "tronmarket-uploads";

export async function findOrphanedImages({ apply = false } = {}) {
  if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_CLOUD_NAME) {
    return { skipped: "Cloudinary is not configured" };
  }

  const products = await Product.find({}).select("images image").lean();
  const referenced = new Set();
  const publicIdFromUrl = (url) => {
    const match = String(url || "").match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
    return match ? decodeURIComponent(match[1]) : null;
  };
  for (const product of products) {
    const urls = [...(product.images || []), product.image].filter(Boolean);
    for (const url of urls) {
      const id = publicIdFromUrl(url);
      if (id) referenced.add(id);
    }
  }

  let orphans = [];
  let nextCursor;
  do {
    const result = await cloudinary.api.resources({
      type: "upload",
      prefix: FOLDER,
      max_results: 500,
      next_cursor: nextCursor,
    });
    for (const resource of result.resources || []) {
      if (!referenced.has(resource.public_id)) orphans.push(resource.public_id);
    }
    nextCursor = result.next_cursor;
  } while (nextCursor);

  let deleted = 0;
  if (apply && orphans.length) {
    for (let i = 0; i < orphans.length; i += 100) {
      const chunk = orphans.slice(i, i + 100);
      const result = await cloudinary.api.delete_resources(chunk).catch(() => null);
      deleted += Object.values(result?.deleted || {}).filter((v) => v === "deleted").length;
    }
  }
  return { referenced: referenced.size, orphans: orphans.length, deleted, applied: apply };
}

let timer = null;
export function startImageCleanupJob() {
  const apply = process.env.IMAGE_CLEANUP_APPLY === "1";
  // Weekly sweep; never deletes unless explicitly enabled.
  timer = setInterval(() => {
    findOrphanedImages({ apply }).catch((error) => console.error("Image cleanup:", error?.message || error));
  }, 7 * 24 * 60 * 60 * 1000);
  timer.unref?.();
}
