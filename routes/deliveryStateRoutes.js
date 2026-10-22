import express from "express";
import { protect, adminOnly } from "../middlewares/authMiddleware.js";
import {
  listDeliveryStates,
  listActiveStateNames,
  setDeliveryStateActive,
} from "../services/deliveryStateService.js";
import { recordAudit } from "../services/auditService.js";

const router = express.Router();

// Public: the states buyers may currently choose at checkout.
router.get("/", async (req, res) => {
  try {
    const states = await listActiveStateNames();
    return res.json({ states });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load delivery states" });
  }
});

// Admin: every state with its toggle.
router.get("/all", protect, adminOnly, async (req, res) => {
  try {
    const states = await listDeliveryStates();
    return res.json({ states });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load delivery states" });
  }
});

// Admin: switch one state on/off.
router.put("/:name", protect, adminOnly, async (req, res) => {
  try {
    const updated = await setDeliveryStateActive(
      req.params.name,
      req.body?.isActive,
    );
    if (!updated) return res.status(404).json({ message: "Unknown state" });
    await recordAudit(
      req,
      "delivery_state.toggle",
      { type: "DeliveryState", id: updated._id },
      { name: updated.name, isActive: updated.isActive },
    ).catch(() => {});
    return res.json({
      _id: updated._id,
      name: updated.name,
      isActive: updated.isActive,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update delivery state" });
  }
});

export default router;
