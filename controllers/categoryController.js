import Category from "../models/Category.js";
import { recordAudit } from "../services/auditService.js";

export const listCategories = async (req, res) => {
  try {
    const query = req.query.includeInactive === "1" && req.user?.role === "admin" ? {} : { isActive: true };
    const categories = await Category.find(query).sort({ name: 1 }).lean();
    return res.json(categories.map((c) => ({ _id: c._id, name: c.name, slug: c.slug, description: c.description, isActive: c.isActive })));
  } catch (error) {
    return res.status(500).json({ message: "Failed to load categories" });
  }
};

export const createCategory = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (name.length < 2) return res.status(400).json({ message: "Category name is required" });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const exists = await Category.findOne({ $or: [{ name }, { slug }] });
    if (exists) return res.status(409).json({ message: "That category already exists" });
    const category = await Category.create({ name, slug, description: String(req.body?.description || "") });
    await recordAudit(req, "category.create", { type: "Category", id: category._id }, { name: category.name });
    return res.status(201).json(category);
  } catch (error) {
    return res.status(500).json({ message: "Could not create the category" });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const updates = {};
    if (req.body?.name !== undefined) {
      updates.name = String(req.body.name).trim();
      updates.slug = updates.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }
    if (req.body?.description !== undefined) updates.description = String(req.body.description);
    if (req.body?.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);
    const category = await Category.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!category) return res.status(404).json({ message: "Category not found" });
    await recordAudit(req, "category.update", { type: "Category", id: category._id }, updates);
    return res.json(category);
  } catch (error) {
    return res.status(500).json({ message: "Could not update the category" });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    await recordAudit(req, "category.delete", { type: "Category", id: category._id }, { name: category.name });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete the category" });
  }
};
