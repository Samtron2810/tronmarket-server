// Payout money path: the ledger buckets, the holds from returns, disputes and
// refunds, and paying a seller exactly once even under concurrent requests.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, fakeRes, seedUser } from "./helpers/harness.mjs";

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

const EIGHT_DAYS_AGO = () => new Date(Date.now() - 8 * 24 * 3600 * 1000);

function order(overrides = {}) {
  return {
    _id: overrides._id || "000000000000000000000001",
    status: "delivered",
    refundStatus: "none",
    deliveredAt: EIGHT_DAYS_AGO(),
    createdAt: EIGHT_DAYS_AGO(),
    updatedAt: EIGHT_DAYS_AGO(),
    sellerFulfillments: [
      {
        _id: "0000000000000000000000a1",
        seller: "00000000000000000000000a",
        status: "delivered",
        payoutAmount: 900,
        deliveredAt: EIGHT_DAYS_AGO(),
        payoutId: null,
      },
    ],
    ...overrides,
  };
}

const SELLER = "00000000000000000000000a";

test("completed packages still count as earned", () => {
  const ledger = ctx.ledger.classifyLedger({
    orders: [order({ sellerFulfillments: [{ _id: "0000000000000000000000a1", seller: SELLER, status: "completed", payoutAmount: 900, deliveredAt: EIGHT_DAYS_AGO() }] })],
    sellerId: SELLER,
  });
  const [s] = ledger.sellers;
  assert.equal(s.earned, 900);
  assert.equal(s.payable, 900);
});

test("an open return holds the seller's package", () => {
  const ledger = ctx.ledger.classifyLedger({
    orders: [order()],
    returns: [{ order: "000000000000000000000001", sellers: [SELLER], status: "requested" }],
    sellerId: SELLER,
  });
  assert.equal(ledger.sellers[0].held, 900);
  assert.equal(ledger.sellers[0].payable, 0);
  assert.equal(ledger.claims.length, 0);
});

test("a refunded return no longer holds or hides the kept items' payout", () => {
  // The refund already took the returned goods off payoutAmount (900 is net).
  const ledger = ctx.ledger.classifyLedger({
    orders: [order()],
    returns: [{ order: "000000000000000000000001", sellers: [SELLER], status: "refunded" }],
    sellerId: SELLER,
  });
  assert.equal(ledger.sellers[0].payable, 900);
  assert.equal(ledger.sellers[0].held, 0);
});

test("a pending refund on the order holds every package until it settles", () => {
  const ledger = ctx.ledger.classifyLedger({
    orders: [order({ refundStatus: "pending" })],
    sellerId: SELLER,
  });
  assert.equal(ledger.sellers[0].held, 900);
  assert.equal(ledger.claims.length, 0);
});

test("two concurrent mark-paid requests pay a seller exactly once", async () => {
  const seller = await seedUser(ctx, { name: "Seller", email: "s@example.com", role: "seller" });
  const buyer = await seedUser(ctx, { name: "Ada", email: "ada@example.com" });
  await ctx.User.updateOne(
    { _id: seller._id },
    { $set: { bankDetails: { bankName: "Test", accountNumber: "0123456789", accountName: "Seller", verifiedAt: new Date() } } },
  );
  const { order: paid } = await ctx.seed({
    buyer,
    items: [{ seller: seller._id, price: 1000, quantity: 1 }, { seller: seller._id, price: 500, quantity: 2 }],
  });
  await ctx.Order.collection.updateOne(
    { _id: paid._id },
    { $set: { status: "delivered", "sellerFulfillments.0.status": "delivered", "sellerFulfillments.0.deliveredAt": EIGHT_DAYS_AGO(), deliveredAt: EIGHT_DAYS_AGO() } },
  );
  await ctx.Order.collection.updateOne(
    { _id: paid._id },
    { $set: { "sellerFulfillments.0.deliveredAt": EIGHT_DAYS_AGO() } },
  );
  const req = () => ({ params: { sellerId: String(seller._id) }, body: {}, user: { _id: seller._id, role: "admin" } });
  const resA = fakeRes();
  const resB = fakeRes();
  await Promise.all([
    ctx.controllers.payout.markPayoutPaid(req(), resA),
    ctx.controllers.payout.markPayoutPaid(req(), resB),
  ]);
  const a = resA;
  const b = resB;
  // One request pays, the other is told the money has already gone out.
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);

  const payouts = await ctx.Payout.find({ seller: seller._id }).lean();
  const paidTotal = payouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const fresh = await ctx.Order.findById(paid._id);
  const expected = fresh.sellerFulfillments[0].payoutAmount;
  assert.equal(paidTotal, expected, "the seller is paid exactly what they are owed, once");
});

test("a refunded package is never paid out; the rest of the order still is", async () => {
  const buyer = await seedUser(ctx, { name: "Ada", email: "ada@example.com" });
  const sellerA = await seedUser(ctx, { name: "A", email: "a@example.com", role: "seller" });
  const sellerB = await seedUser(ctx, { name: "B", email: "b@example.com", role: "seller" });
  const { order: paid } = await ctx.seed({
    buyer,
    items: [{ seller: sellerA._id, price: 1000, quantity: 1 }, { seller: sellerB._id, price: 500, quantity: 1 }],
  });
  await ctx.refund.refundGoods({
    orderId: paid._id,
    allocations: [{ seller: sellerA._id, gross: 1000 }],
    kind: "admin",
  });
  await ctx.Order.collection.updateOne(
    { _id: paid._id },
    { $set: { status: "delivered", deliveredAt: EIGHT_DAYS_AGO(), "sellerFulfillments.$[].status": "delivered", "sellerFulfillments.$[].deliveredAt": EIGHT_DAYS_AGO() } },
  );

  const ledgerA = await ctx.ledger.loadLedger({ sellerId: sellerA._id });
  assert.equal(ledgerA.sellers.find((s) => String(s.seller) === String(sellerA._id))?.payable ?? 0, 0);
  const ledgerB = await ctx.ledger.loadLedger({ sellerId: sellerB._id });
  const b = ledgerB.sellers.find((s) => String(s.seller) === String(sellerB._id));
  assert.equal(b.payable, ctx.pricing.commissionFor(500).payoutAmount);
});

test("a seller is paid only once their bank details are verified", async () => {
  const buyer = await ctx.seedUser({ name: "Ada", email: "ada@example.com" });
  const seller = await ctx.seedUser({ name: "Seller", email: "s@example.com", role: "seller" });
  const admin = await ctx.seedUser({ name: "Admin", email: "admin@example.com", role: "admin" });
  const { order } = await ctx.seed({ buyer, status: "delivered", items: [{ seller: seller._id, price: 1000, name: "Shirt" }] });
  const old = EIGHT_DAYS_AGO();
  await ctx.Order.collection.updateOne(
    { _id: order._id },
    { $set: { updatedAt: old, deliveredAt: old, "sellerFulfillments.$[].deliveredAt": old, "sellerFulfillments.$[].status": "delivered" } },
  );
  await ctx.User.collection.updateOne(
    { _id: seller._id },
    { $set: { bankDetails: { bankName: "Test Bank", accountNumber: "0123456789", accountName: "Seller" } } },
  );
  const req = () => ({ params: { sellerId: String(seller._id) }, body: {}, user: { _id: admin._id, role: "admin" } });

  const blocked = fakeRes();
  await ctx.controllers.payout.markPayoutPaid(req(), blocked);
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.body.message, /Verify this seller's bank details/);
  assert.equal(await ctx.Payout.countDocuments({ seller: seller._id }), 0);

  await ctx.User.collection.updateOne({ _id: seller._id }, { $set: { "bankDetails.verifiedAt": new Date() } });
  const paid = fakeRes();
  await ctx.controllers.payout.markPayoutPaid(req(), paid);
  assert.equal(paid.statusCode, 201, JSON.stringify(paid.body));
  assert.equal(await ctx.Payout.countDocuments({ seller: seller._id }), 1);
});
