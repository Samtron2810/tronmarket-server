import cloudinary from "../config/cloudinary.js";
import Product from "../models/Product.js";

export function cloudinaryPublicIdFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("cloudinary.com")) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.indexOf("upload");
    if (uploadIndex < 0) return null;

    let publicParts = parts.slice(uploadIndex + 1).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

    // Cloudinary delivery URLs may contain transformation segments before
    // the version/public-id portion. Product uploads use the predictable
    // tronmarket/products folder, so anchor cleanup to that folder and
    // ignore any prefix transformations/version.
    const folderIndex = publicParts.findIndex(
      (part, index) =>
        part === "tronmarket" && publicParts[index + 1] === "products",
    );
    if (folderIndex < 0) return null;
    publicParts = publicParts.slice(folderIndex);

    const publicId = publicParts.join("/").replace(/\.[a-zA-Z0-9]+$/, "");
    return publicId.startsWith("tronmarket/products/") ? publicId : null;
  } catch {
    return null;
  }
}

export function removedImageUrls(previousUrls = [], nextUrls = []) {
  const next = new Set((nextUrls || []).filter(Boolean));
  return [...new Set((previousUrls || []).filter((url) => url && !next.has(url)))];
}

export async function deleteCloudinaryImages(urls = [], excludeProductId = null) {
  const candidates = [...new Set((urls || []).filter(Boolean))];
  if (!candidates.length) return;

  for (const url of candidates) {
    const publicId = cloudinaryPublicIdFromUrl(url);
    if (!publicId) continue;

    // The same uploaded URL can accidentally be reused on another listing;
    // never pull an asset that a surviving product still references.
    const stillUsed = await Product.exists({
      ...(excludeProductId ? { _id: { $ne: excludeProductId } } : {}),
      $or: [{ image: url }, { images: url }],
    }).catch(() => null);
    if (stillUsed) continue;

    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: "image",
        invalidate: true,
      });
    } catch (error) {
      // Cleanup is best-effort: the product change has already succeeded,
      // and an orphan report in logs is preferable to failing the request.
      console.error("Cloudinary cleanup failed:", publicId, error?.message || error);
    }
  }
}
