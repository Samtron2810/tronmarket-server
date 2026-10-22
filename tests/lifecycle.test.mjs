// Lifecycle sweeper money path: a paid order nobody ships by the deadline is
// cancelled and refunded in full, through the same refund engine.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, seedUser } from "./helpers/harness.mjs";

let ctx;
before(async () => {
  ctx = await bootstrap();
});
after(async () => {
  await ctx?.close();
});
beforeEach(async () => {
  await ctx.resetDb();
  ctx.fake.state.refundMode = "processed";
  ctx.fake.state.refundCalls.length = 0;
});

test("an unshipped, multi-seller order past its ship deadline is cancelled and refunded in full", async () => {
  const buyer = await seedUser(ctx, { name: "Ada", email: "ada@example.com" });
  const sellerA = await seedUser(ctx, { name: "A", email: "a@example.com", role: "seller" });
  const sellerB = await seedUser(ctx, { name: "B", email: "b@example.com", role: "seller" });
  const { order } = await ctx.seed({
    buyer,
    shippingPrice: 150,
    items: [{ seller: sellerA._id, price: 1000, quantity: 1 }, { seller: sellerB._id, price: 500, quantity: 1 }],
  });
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  await ctx.Order.collection.updateOne({ _id: order._id }, { $set: { paidAt: eightDaysAgo } });

  const summary = await ctx.lifecycle.runLifecycleSweep({ now: new Date() });
  assert.equal(summary.cancelled, 1, JSON.stringify(summary));
  assert.equal(summary.errors, 0);

  const fresh = await ctx.Order.findById(order._id);
  assert.equal(fresh.status, "cancelled");
  assert.equal(fresh.refundStatus, "processed");
  const refunds = await ctx.Refund.find({ order: order._id, status: "processed" }).lean();
  assert.equal(refunds.reduce((s, r) => s + r.amount, 0), 1650, "goods 1500 + delivery 150");
  assert.equal(ctx.fake.state.refundCalls.length, 1);
  assert.equal(ctx.fake.state.refundCalls[0].amount, 165000);
});

const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

async function claimedOrder({ fulfilmentStatus, at, status, stampDelivered = true }) {
  const buyer = await ctx.seedUser({ name: "Ada", email: "ada@example.com" });
  const seller = await ctx.seedUser({ name: "Seller", email: "s@example.com", role: "seller" });
  const { order } = await ctx.seed({ buyer, status, items: [{ seller: seller._id, price: 1000, name: "Shirt" }] });
  await ctx.Order.collection.updateOne(
    { _id: order._id },
    {
      $set: {
        updatedAt: at,
        deliveredAt: at,
        "sellerFulfillments.$[].status": fulfilmentStatus,
        ...(stampDelivered ? { "sellerFulfillments.$[].deliveredAt": at } : {}),
        status,
      },
    },
  );
  return { seller, order };
}

test("a seller-claimed delivery is auto-confirmed after the confirm window", async () => {
  const { seller, order } = await claimedOrder({
    fulfilmentStatus: "delivery-claimed",
    at: daysAgo(8),
    status: "processing",
    stampDelivered: false,
  });
  const summary = await ctx.lifecycle.runLifecycleSweep({ now: new Date() });
  assert.equal(summary.confirmed, 1, JSON.stringify(summary));
  const fresh = await ctx.Order.findById(order._id).lean();
  const pkg = fresh.sellerFulfillments.find((f) => String(f.seller) === String(seller._id));
  assert.equal(pkg.status, "delivered");
  // The package's own clock starts at confirmation, not at the last order save.
  assert.ok(pkg.deliveredAt, "deliveredAt must be stamped");
  assert.ok(Date.now() - new Date(pkg.deliveredAt).getTime() < 60_000, "stamped at confirmation time");
});

test("a delivered package is auto-completed after the review period", async () => {
  const { seller, order } = await claimedOrder({ fulfilmentStatus: "delivered", at: daysAgo(15), status: "delivered" });
  const summary = await ctx.lifecycle.runLifecycleSweep({ now: new Date() });
  assert.equal(summary.completed, 1, JSON.stringify(summary));
  const fresh = await ctx.Order.findById(order._id).lean();
  assert.equal(fresh.sellerFulfillments.find((f) => String(f.seller) === String(seller._id)).status, "completed");
});

test("an open 'not received' report stops auto-completion", async () => {
  const { seller, order } = await claimedOrder({ fulfilmentStatus: "delivered", at: daysAgo(15), status: "delivered" });
  await ctx.Dispute.collection.insertOne({
    order: order._id,
    seller: seller._id,
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const summary = await ctx.lifecycle.runLifecycleSweep({ now: new Date() });
  assert.equal(summary.completed, 0, JSON.stringify(summary));
  const fresh = await ctx.Order.findById(order._id).lean();
  assert.equal(fresh.sellerFulfillments.find((f) => String(f.seller) === String(seller._id)).status, "delivered");
});
