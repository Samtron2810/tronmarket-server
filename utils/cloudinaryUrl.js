/**
 * Generate optimized Cloudinary URLs with automatic format & quality.
 *
 * - f_auto   → serves WebP/AVIF when browser supports it
 * - q_auto   → Cloudinary's perceptual quality algorithm (saves 30-60% size)
 * - w_       → responsive width (keeps images small when not full-size)
 *
 * If the URL is not from Cloudinary, returns it unchanged.
 */

const CLOUDINARY_REGEX =
  /\.cloudinary\.com\/(?:[^/]+\/)?image\/upload\/(?:v\d+\/)?(.+)/;

export function optimizeImageUrl(url, width = 800) {
  if (!url) return url;

  // Only transform Cloudinary-hosted images
  if (!url.includes("cloudinary.com") || !url.includes("/upload/")) {
    return url;
  }

  // If the URL already has transformations, return as-is to avoid breaking them
  if (url.includes("/upload/") && !url.includes("/upload/v")) {
    // Handle case where no version is present
    const baseUrl = url.replace(
      "/upload/",
      `/upload/f_auto,q_auto,w_${width}/`,
    );
    return baseUrl;
  }

  // Has version (e.g., /upload/v12345/...)
  const baseUrl = url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
  return baseUrl;
}

/**
 * For thumbnail/list views — small, fast images.
 */
export function getThumbnailUrl(url) {
  return optimizeImageUrl(url, 300);
}

/**
 * For product detail / preview modal — medium quality, larger width.
 */
export function getDetailUrl(url) {
  return optimizeImageUrl(url, 1200);
}
