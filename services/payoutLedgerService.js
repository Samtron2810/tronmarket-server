// The payout ledger: the single source of truth for what each seller has
// earned, what is already paid, what is held, and what can be paid right now.
//
// Money is tracked per seller fulfilment (one seller's share of one order):
//
//   earned         every settleable fulfilment (delivered or completed) that
//                  was not refunded. = paidOut + pendingRelease + held + payable
//   paidOut        claimed by a payout already (Order.sellerFulfillments[].payoutId)
//   pendingRelease delivered, but the dispute window is still open
//   held           an open return / "not received" report, or a refund pending
//   payable        released and unclaimed: this is what an admin can pay now
//   refunded       refunded or upheld against the seller; never paid
//
// Completed orders count (the old ledger dropped them, which is why earnings
// vanished on completion). Open returns, pending refunds and disputes hold
// money instead of silently inflating "outstanding".

import Order from "../models/Order.js";
import ReturnRequest from "../models/ReturnRequest.js";
import Dispute from "../models/Dispute.js";
import { POLICY, addDays } from "./orderPolicy.js";
import { money } from "./pricingService.js";

export const SETTLEABLE = ["delivered", "completed"];
const OPEN_RETURN = ["requested", "approved"];
const ALL_OPEN_RETURN_STATES = ["requested", "approved", "refunded"];

const key = (value) => (value ? String(value) : "");
const ALL_SELLERS = "*"; // a return with no seller list covers every seller

function windowClosed(fulfillment, order, now) {
  if (fulfillment.status === "completed") return true;
  const deliveredAt = fulfillment.deliveredAt || order.deliveredAt || order.updatedAt || order.createdAt;
  return addDays(deliveredAt, POLICY.disputeWindowDays) <= now;
}

// Pure function: decides every fulfilment's bucket. Inputs are plain objects
// (lean documents), so it can be exercised without a database.
export function classifyLedger({ orders, returns = [], disputes = [], sellerId = null, now = new Date() }) {
  const held = new Set();
  const refunded = new Set();

  const mark = (set, orderId, sellers) => {
    if (!sellers.length) set.add(`${orderId}:${ALL_SELLERS}`);
    for (const seller of sellers) set.add(`${orderId}:${seller}`);
  };

  for (const d of disputes) {
    if (d.status === "open") mark(held, key(d.order), [key(d.seller)]);
    if (d.status === "upheld") mark(refunded, key(d.order), [key(d.seller)]);
  }
  for (const r of returns) {
    const sellers = (r.sellers || []).map(key);
    if (r.status === "refunded") mark(refunded, key(r.order), sellers);
    else if (OPEN_RETURN.includes(r.status)) mark(held, key(r.order), sellers);
  }

  const isIn = (set, orderId, seller) =>
    set.has(`${orderId}:${seller}`) || set.has(`${orderId}:${ALL_SELLERS}`);

  const sellers = new Map();
  const claims = [];
  const bucket = (id) => {
    if (!sellers.has(id)) {
      sellers.set(id, {
        seller: id,
        earned: 0,
        paidOut: 0,
        pendingRelease: 0,
        held: 0,
        payable: 0,
        refunded: 0,
        fulfilments: 0,
      });
    }
    return sellers.get(id);
  };

  for (const order of orders) {
    const orderId = key(order._id);
    for (const f of order.sellerFulfillments || []) {
      if (!SETTLEABLE.includes(f.status)) continue;
      const sellerKey = key(f.seller);
      if (sellerId && sellerKey !== key(sellerId)) continue;

      const amount = money(f.payoutAmount || 0);
      const b = bucket(sellerKey);
      b.fulfilments += 1;

      if (f.payoutId) {
        b.paidOut = money(b.paidOut + amount);
        b.earned = money(b.earned + amount);
        continue;
      }
      if (order.refundStatus === "processed" || isIn(refunded, orderId, sellerKey)) {
        b.refunded = money(b.refunded + amount);
        continue;
      }
      if (order.refundStatus === "pending" || isIn(held, orderId, sellerKey)) {
        b.held = money(b.held + amount);
        b.earned = money(b.earned + amount);
        continue;
      }
      b.earned = money(b.earned + amount);
      if (!windowClosed(f, order, now)) {
        b.pendingRelease = money(b.pendingRelease + amount);
        continue;
      }
      b.payable = money(b.payable + amount);
      claims.push({ order: order._id, fulfilmentId: f._id, seller: f.seller, amount });
    }
  }

  return { sellers: [...sellers.values()], claims };
}

// Loads the inputs for the ledger from the database and classifies them.
export async function loadLedger({ sellerId = null, now = new Date() } = {}) {
  const orderFilter = sellerId
    ? { sellerFulfillments: { $elemMatch: { seller: sellerId, status: { $in: SETTLEABLE } } } }
    : { "sellerFulfillments.status": { $in: SETTLEABLE } };

  const orders = await Order.find(orderFilter)
    .select("status refundStatus deliveredAt createdAt updatedAt sellerFulfillments._id sellerFulfillments.seller sellerFulfillments.status sellerFulfillments.payoutAmount sellerFulfillments.payoutId sellerFulfillments.deliveredAt sellerFulfillments.completedAt")
    .lean();
  const orderIds = orders.map((o) => o._id);

  const [returns, disputes] = await Promise.all([
    ReturnRequest.find({ order: { $in: orderIds }, status: { $in: ALL_OPEN_RETURN_STATES } })
      .select("order sellers status")
      .lean(),
    Dispute.find({ order: { $in: orderIds }, status: { $in: ["open", "upheld"] } })
      .select("order seller status")
      .lean(),
  ]);

  return classifyLedger({ orders, returns, disputes, sellerId, now });
}
