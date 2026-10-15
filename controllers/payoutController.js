import Order from "../models/Order.js";
import Payout from "../models/Payout.js";
import User from "../models/User.js";
import { money } from "../services/pricingService.js";
import { recordAudit } from "../services/auditService.js";

// Payout ledger: seller earnings come from delivered fulfilments (M9). The
// ledger records when an admin marks those earnings as paid out.

async function sellerBalances() {
  const rows = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $unwind: "$sellerFulfillments" },
    { $match: { "sellerFulfillments.status": "delivered" } },
    {
      $group: {
        _id: "$sellerFulfillments.seller",
        earned: { $sum: "$sellerFulfillments.payoutAmount" },
        pendingOrders: { $addToSet: "$_id" },
        fulfilments: { $sum: 1 },
      },
    },
  ]);
  const paidRows = await Payout.aggregate([
    { $group: { _id: "$seller", paid: { $sum: "$amount" }, lastPaidAt: { $max: "$paidAt" } } },
  ]);
  const paidBySeller = new Map(paidRows.map((r) => [String(r._id), r]));
  return rows.map((row) => {
    const paid = paidBySeller.get(String(row._id));
    return {
      seller: row._id,
      earned: money(row.earned),
      paidOut: money(paid?.paid || 0),
      outstanding: money(row.earned - (paid?.paid || 0)),
      orders: row.pendingOrders?.length || 0,
      fulfilments: row.fulfilments || 0,
      lastPaidAt: paid?.lastPaidAt || null,
    };
  });
}

export const listPayouts = async (req, res) => {
  try {
    const [balances, history] = await Promise.all([
      sellerBalances(),
      Payout.find().sort({ createdAt: -1 }).limit(100).populate("seller", "name email").lean(),
    ]);
    const sellerIds = balances.map((b) => b.seller).filter(Boolean);
    const sellers = await User.find({ _id: { $in: sellerIds } }).select("name email sellerVerified").lean();
    const byId = new Map(sellers.map((s) => [String(s._id), s]));
    return res.json({
      balances: balances.map((b) => ({
        ...b,
        sellerName: byId.get(String(b.seller))?.name || "Seller",
        sellerEmail: byId.get(String(b.seller))?.email || "",
        sellerVerified: Boolean(byId.get(String(b.seller))?.sellerVerified),
      })),
      history,
    });
  } catch (error) {
    console.error("listPayouts:", error);
    return res.status(500).json({ message: "Failed to load payouts" });
  }
};

export const markPayoutPaid = async (req, res) => {
  try {
    const balances = await sellerBalances();
    const balance = balances.find((b) => String(b.seller) === String(req.params.sellerId));
    if (!balance) return res.status(404).json({ message: "Seller has no earnings" });
    const requested = req.body?.amount !== undefined ? money(req.body.amount) : balance.outstanding;
    if (!(requested > 0) || requested > balance.outstanding) {
      return res.status(400).json({ message: "Enter an amount up to the outstanding balance" });
    }

    // Pin this payout to the delivered orders behind the balance so the
    // ledger is auditable per order.
    const delivered = await Order.find({
      status: "delivered",
      "sellerFulfillments.seller": req.params.sellerId,
      "sellerFulfillments.status": "delivered",
    }).select("_id").lean();

    const payout = await Payout.create({
      seller: req.params.sellerId,
      amount: requested,
      orderIds: delivered.map((o) => o._id),
      fulfilmentCount: balance.fulfilments,
      method: ["bank_transfer", "cash", "other"].includes(req.body?.method) ? req.body.method : "bank_transfer",
      note: String(req.body?.note || "").slice(0, 300),
      markedBy: req.user._id,
      paidAt: new Date(),
    });
    await recordAudit(req, "payout.mark_paid", { type: "User", id: req.params.sellerId }, { amount: requested, payout: String(payout._id) });
    return res.status(201).json(payout);
  } catch (error) {
    return res.status(500).json({ message: "Could not record the payout" });
  }
};

export const myPayouts = async (req, res) => {
  try {
    const [history, allBalances] = await Promise.all([
      Payout.find({ seller: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      sellerBalances(),
    ]);
    const mine = allBalances.find((b) => String(b.seller) === String(req.user._id));
    return res.json({
      balance: mine || { earned: 0, paidOut: 0, outstanding: 0, orders: 0, fulfilments: 0, lastPaidAt: null },
      history,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load payouts" });
  }
};
