import mongoose from "mongoose";
import Order from "../models/Order.js";
import Payout from "../models/Payout.js";
import User from "../models/User.js";
import ReturnRequest from "../models/ReturnRequest.js";
import Dispute from "../models/Dispute.js";
import { SETTLEABLE, loadLedger } from "../services/payoutLedgerService.js";
import { money } from "../services/pricingService.js";
import { recordAudit } from "../services/auditService.js";

const METHODS = ["bank_transfer", "cash", "other"];

function maskAccount(number) {
  return number ? `••••${String(number).slice(-4)}` : "";
}

function bankView(user, { reveal }) {
  const bank = user?.bankDetails || {};
  return {
    configured: Boolean(bank.accountNumber),
    bankName: bank.bankName || "",
    accountName: bank.accountName || "",
    accountNumber: reveal ? bank.accountNumber || "" : maskAccount(bank.accountNumber),
    verified: Boolean(bank.verifiedAt),
    verifiedAt: bank.verifiedAt || null,
    updatedAt: bank.updatedAt || null,
  };
}

// True while anything still stops this seller's package from being paid:
// an open dispute, an open return touching them, or a refund in flight.
// Refunded goods are already off the payout amount, so they don't hold it.
async function isHeld(orderId, sellerId) {
  const [dispute, giveBack, order] = await Promise.all([
    Dispute.exists({ order: orderId, seller: sellerId, status: { $in: ["open", "upheld"] } }),
    ReturnRequest.exists({
      order: orderId,
      status: { $in: ["requested", "approved"] },
      $or: [{ sellers: sellerId }, { sellers: { $size: 0 } }, { sellers: { $exists: false } }],
    }),
    Order.findById(orderId).select("refundStatus").lean(),
  ]);
  return Boolean(dispute || giveBack || ["pending", "processed"].includes(order?.refundStatus));
}

// Undo one fulfilment claim, but only if it is still held by this payout.
async function releaseClaim(claim, payoutId) {
  await Order.updateOne(
    { _id: claim.order, sellerFulfillments: { $elemMatch: { seller: claim.seller, payoutId } } },
    {
      $set: {
        "sellerFulfillments.$.payoutId": null,
        "sellerFulfillments.$.payoutStatus": "eligible",
        "sellerFulfillments.$.paidOutAt": null,
      },
    },
  );
}

export const listPayouts = async (req, res) => {
  try {
    const ledger = await loadLedger();
    const ids = ledger.sellers.map((s) => s.seller);
    const [users, history] = await Promise.all([
      User.find({ _id: { $in: ids } }).select("name email sellerVerified +bankDetails").lean(),
      Payout.find().sort({ createdAt: -1 }).limit(100).populate("seller", "name email").lean(),
    ]);
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return res.json({
      balances: ledger.sellers.map((s) => {
        const user = byId.get(String(s.seller));
        return {
          ...s,
          outstanding: s.payable,
          sellerName: user?.name || "Seller",
          sellerEmail: user?.email || "",
          sellerVerified: Boolean(user?.sellerVerified),
          bank: bankView(user, { reveal: true }),
        };
      }),
      history,
    });
  } catch (error) {
    console.error("listPayouts:", error);
    return res.status(500).json({ message: "Failed to load payouts" });
  }
};

export const markPayoutPaid = async (req, res) => {
  const sellerId = req.params.sellerId;
  try {
    const seller = await User.findById(sellerId).select("name +bankDetails").lean();
    if (!seller) return res.status(404).json({ message: "Seller not found" });
    if (!seller.bankDetails?.accountNumber || !seller.bankDetails?.verifiedAt) {
      return res.status(409).json({ message: "Verify this seller's bank details before paying them out" });
    }

    const ledger = await loadLedger({ sellerId });
    const candidates = ledger.claims.filter((c) => String(c.seller) === String(sellerId));
    if (candidates.length === 0) {
      return res.status(409).json({ message: "Nothing is payable to this seller right now" });
    }

    // Claim each fulfilment atomically. The update only matches a fulfilment
    // that no payout has claimed yet, so two concurrent "mark paid" requests
    // split the work instead of paying the same money twice.
    const payoutId = new mongoose.Types.ObjectId();
    const now = new Date();
    const claimed = [];
    for (const c of candidates) {
      const result = await Order.updateOne(
        // Keyed by (order, seller): one fulfilment per seller per order. The
        // amount must still be the one the ledger showed, so a refund that
        // landed in between cannot be paid at the old figure.
        {
          _id: c.order,
          sellerFulfillments: {
            $elemMatch: {
              seller: c.seller,
              status: { $in: SETTLEABLE },
              payoutAmount: c.amount,
              payoutId: null,
              legacyManual: { $ne: true },
            },
          },
        },
        {
          $set: {
            "sellerFulfillments.$.payoutId": payoutId,
            "sellerFulfillments.$.payoutStatus": "paid",
            "sellerFulfillments.$.paidOutAt": now,
          },
        },
      );
      if (result.modifiedCount === 1) claimed.push(c);
    }
    if (claimed.length === 0) {
      return res.status(409).json({ message: "These earnings were just paid out by another request" });
    }

    // A return or report opened while we were claiming must still stop the
    // money: release any claim that is now held.
    const payable = [];
    for (const c of claimed) {
      if (await isHeld(c.order, c.seller)) await releaseClaim(c, payoutId);
      else payable.push(c);
    }
    if (payable.length === 0) {
      return res.status(409).json({ message: "Earnings are on hold (open return or report). Nothing was paid." });
    }

    const amount = money(payable.reduce((sum, c) => sum + c.amount, 0));
    try {
      const payout = await Payout.create({
        _id: payoutId,
        seller: sellerId,
        amount,
        orderIds: [...new Set(payable.map((c) => String(c.order)))],
        fulfilments: payable.map((c) => ({ order: c.order, seller: c.seller, amount: c.amount })),
        fulfilmentCount: payable.length,
        method: METHODS.includes(req.body?.method) ? req.body.method : "bank_transfer",
        note: String(req.body?.note || "").slice(0, 300),
        markedBy: req.user._id,
        paidAt: now,
      });
      await recordAudit(req, "payout.mark_paid", { type: "User", id: sellerId }, {
        amount,
        payout: String(payout._id),
        fulfilments: payable.length,
      });
      return res.status(201).json(payout);
    } catch (error) {
      // Could not write the ledger row: give the fulfilments back so they can be paid later.
      for (const c of payable) await releaseClaim(c, payoutId);
      throw error;
    }
  } catch (error) {
    console.error("markPayoutPaid:", error);
    return res.status(500).json({ message: "Could not record the payout" });
  }
};

export const myPayouts = async (req, res) => {
  try {
    const [ledger, history, user] = await Promise.all([
      loadLedger({ sellerId: req.user._id }),
      Payout.find({ seller: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      User.findById(req.user._id).select("+bankDetails").lean(),
    ]);
    const mine = ledger.sellers.find((s) => String(s.seller) === String(req.user._id));
    const balance = mine
      ? { ...mine, outstanding: mine.payable }
      : { earned: 0, paidOut: 0, pendingRelease: 0, held: 0, payable: 0, outstanding: 0, refunded: 0, fulfilments: 0 };
    return res.json({ balance, history, bank: bankView(user, { reveal: false }) });
  } catch (error) {
    console.error("myPayouts:", error);
    return res.status(500).json({ message: "Failed to load payouts" });
  }
};

export const getMyBankDetails = async (req, res) => {
  const user = await User.findById(req.user._id).select("+bankDetails").lean();
  return res.json(bankView(user, { reveal: true }));
};

export const saveMyBankDetails = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("+bankDetails").lean();
    if (!user) return res.status(404).json({ message: "Account not found" });

    const next = {
      bankName: String(req.body.bankName || "").trim(),
      accountNumber: String(req.body.accountNumber || "").trim(),
      accountName: String(req.body.accountName || "").trim(),
    };
    const prev = user.bankDetails || {};
    const changed =
      (prev.bankName || "") !== next.bankName ||
      (prev.accountNumber || "") !== next.accountNumber ||
      (prev.accountName || "") !== next.accountName;

    // Any change to the account needs a fresh admin check before payout.
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          bankDetails: {
            ...next,
            updatedAt: new Date(),
            verifiedAt: changed ? null : prev.verifiedAt || null,
            verifiedBy: changed ? null : prev.verifiedBy || null,
          },
        },
      },
    );
    const saved = await User.findById(req.user._id).select("+bankDetails").lean();
    return res.json(bankView(saved, { reveal: true }));
  } catch (error) {
    console.error("saveMyBankDetails:", error);
    return res.status(500).json({ message: "Could not save bank details" });
  }
};

export const setBankVerified = async (req, res) => {
  try {
    const user = await User.findById(req.params.sellerId).select("+bankDetails").lean();
    if (!user) return res.status(404).json({ message: "Seller not found" });
    if (!user.bankDetails?.accountNumber) {
      return res.status(409).json({ message: "This seller has not added bank details yet" });
    }
    const verified = req.body.verified === true;
    await User.updateOne(
      { _id: req.params.sellerId },
      {
        $set: {
          "bankDetails.verifiedAt": verified ? new Date() : null,
          "bankDetails.verifiedBy": verified ? req.user._id : null,
        },
      },
    );
    await recordAudit(req, verified ? "seller.bank_verified" : "seller.bank_unverified", { type: "User", id: req.params.sellerId }, {});
    const saved = await User.findById(req.params.sellerId).select("+bankDetails").lean();
    return res.json(bankView(saved, { reveal: true }));
  } catch (error) {
    console.error("setBankVerified:", error);
    return res.status(500).json({ message: "Could not update bank verification" });
  }
};
