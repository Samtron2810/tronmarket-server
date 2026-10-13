import mongoose from "mongoose";

const LABELS = {
  id: "Resource",
  productId: "Product",
  variantId: "Product variant",
  userId: "User",
};

export function validateObjectIdParams(...params) {
  const names = params.length ? params : ["id"];
  return (req, res, next) => {
    for (const name of names) {
      const value = req.params?.[name];
      if (value !== undefined && !mongoose.Types.ObjectId.isValid(value)) {
        return res.status(404).json({
          success: false,
          message: `${LABELS[name] || "Resource"} not found`,
        });
      }
    }
    return next();
  };
}

export const validateObjectIdParam = (name = "id") =>
  validateObjectIdParams(name);
