// Refund money path: per-package and per-return refunds on multi-seller orders,
// the shared cap, webhook and reconciliation updates, disputes, and races.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, fakeRes } from "./helpers/harness.mjs";

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

const sameId = (a, b) => String(a) === String(b);

async function twoSellerOrder({ discountAmount = 0, shippingPrice = 0 } = {}) {
  const buyer = await ctx.seedUser({ name: "Ada", email: "ada@example.com" });
  const sellerA = await ctx.seedUser({ name: "Seller A", email: "a@example.com", role: "seller" });
  const sellerB = await ctx.seedUser({ name: "Seller B", email: "b@example.com", role: "seller" });
  const { order, payment } = await ctx.seed({
    buyer,
    discountAmount,
    shippingPrice,
    items: [
      { seller: sellerA._id, price: 1000, quantity: 2, name: "Shirt" }, // goods 2000
      { seller: sellerB._id, price: 500, quantity: 1, name: "Cap" }, // goods 500
    ],
  });
  return { buyer, sellerA, sellerB, order, payment };
}

const fulfilmentOf = (order, seller) =>
  order.sellerFulfillments.find((f) => sameId(f.seller, seller._id));

async function stockOf(order, index) {
  const { product } = order.orderItems[index];
  return (await ctx.Product.collection.findOne({ _id: product })).stock;
}

async function cancelPackage(seller, order, reason = "Out of stock") {
  const res = fakeRes();
  await ctx.controllers.package.cancelSellerPackage(
    { user: seller, params: { id: String(order._id) }, body: { reason } },
    res,
  );
  return res;
}

test("a seller cancelling their package refunds only their goods and restocks only their lines", async () => {
  const { order, sellerA, sellerB } = await twoSellerOrder();
  const res = await cancelPackage(sellerA, order);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const refunds = await ctx.Refund.find({ order: order._id }).lean();
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].status, "processed");
  assert.equal(refunds[0].amount, 2000);
  assert.equal(ctx.fake.state.refundCalls.length, 1);
  assert.equal(ctx.fake.state.refundCalls[0].amount, 200000, "Paystack gets kobo");

  const fresh = await ctx.Order.findById(order._id);
  const fA = fulfilmentOf(fresh, sellerA);
  const fB = fulfilmentOf(fresh, sellerB);
  assert.equal(fA.status, "cancelled");
  assert.equal(fA.refundedSubtotal, 2000);
  assert.equal(fA.payoutAmount, 0);
  assert.equal(fB.status, "processing", "the other seller's package is untouched");
  assert.equal(fB.refundedSubtotal, 0);
  assert.equal(fB.payoutAmount, ctx.pricing.commissionFor(500, fB.commissionRate).payoutAmount);
  assert.equal(fresh.refundStatus, "partial");
  assert.notEqual(fresh.status, "cancelled", "the order stays live for the other seller");

  assert.equal(await stockOf(fresh, 0), 12, "seller A's shirts go back on sale");
  assert.equal(await stockOf(fresh, 1), 10, "seller B's cap stock is untouched");
});

test("a refund Paystack rejects leaves the package, stock and money exactly as they were", async () => {
  const { order, sellerA } = await twoSellerOrder();
  ctx.fake.state.refundMode = "reject";
  const res = await cancelPackage(sellerA, order);
  assert.equal(res.statusCode, 502, JSON.stringify(res.body));

  const fresh = await ctx.Order.findById(order._id);
  const fA = fulfilmentOf(fresh, sellerA);
  assert.equal(fA.status, "processing", "the package is put back so it can still ship");
  assert.equal(fA.refundedSubtotal, 0);
  assert.equal(fresh.refundStatus, "failed");
  assert.equal(await stockOf(fresh, 0), 10);
  const refunds = await ctx.Refund.find({ order: order._id }).lean();
  assert.ok(refunds.every((r) => r.status === "failed"));
});

test("the order discount is shared pro rata; shipping is not refunded on a partial cancel", async () => {
  // Goods 2500, discount 300 -> 12%. Seller A's 2000 of goods refunds at 88%.
  const { order, sellerA } = await twoSellerOrder({ discountAmount: 300, shippingPrice: 200 });
  const res = await cancelPackage(sellerA, order);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [refund] = await ctx.Refund.find({ order: order._id }).lean();
  assert.equal(refund.amount, 1760);
  assert.equal(ctx.fake.state.refundCalls[0].amount, 176000);
});

test("cancelling the whole order after a partial refund refunds only what is left, shipping included", async () => {
  const { order, sellerA, sellerB } = await twoSellerOrder({ shippingPrice: 200 }); // total 2700
  assert.equal((await ctx.Payment.findOne({ order: order._id })).amount, 2700);

  const partial = await cancelPackage(sellerA, order);
  assert.equal(partial.statusCode, 200, JSON.stringify(partial.body));

  const fresh = await ctx.Order.findById(order._id);
  const cancelled = await ctx.cancellation.cancelOrderWithRefund(fresh, {
    allowedStatuses: ["paid", "processing"],
    note: "Buyer cancelled",
    refundReason: "Buyer cancelled",
  });
  assert.equal(cancelled.order.status, "cancelled");
  assert.equal(ctx.fake.state.refundCalls.length, 2);
  assert.equal(ctx.fake.state.refundCalls[1].amount, 70000, "700 left: B's goods 500 + shipping 200");

  const after = await ctx.Order.findById(order._id);
  assert.equal(after.refundStatus, "processed");
  assert.equal(fulfilmentOf(after, sellerB).refundedSubtotal, 500);
  const total = (await ctx.Refund.find({ order: order._id, status: "processed" }).lean())
    .reduce((s, r) => s + r.amount, 0);
  assert.equal(total, 2700, "the buyer receives exactly what was charged");
});

test("a return refunds only the returned lines, for that seller, and reduces their payout", async () => {
  const { order, sellerA, sellerB, buyer } = await twoSellerOrder();
  const returnRequest = await ctx.ReturnRequest.create({
    order: order._id,
    user: buyer._id,
    reason: "Too small",
    items: [{ product: order.orderItems[0].product, seller: sellerA._id, name: "Shirt", quantity: 1, price: 1000 }],
    sellers: [sellerA._id],
    status: "approved",
  });

  // First attempt fails at Paystack; the retry must refund exactly once.
  ctx.fake.state.refundMode = "reject";
  await assert.rejects(ctx.refund.refundReturnRequest(returnRequest), (e) => e.status === 502);
  ctx.fake.state.refundMode = "processed";
  await ctx.refund.refundReturnRequest(returnRequest);
  await ctx.refund.refundReturnRequest(returnRequest);

  // Two Paystack calls in total: the rejected attempt and the one that worked.
  // The second retry must not call Paystack again.
  assert.equal(ctx.fake.state.refundCalls.length, 2, "no double refund on retry");
  const processed = await ctx.Refund.countDocuments({ returnRequest: returnRequest._id, status: "processed" });
  assert.equal(processed, 1);
  const fresh = await ctx.Order.findById(order._id);
  const fA = fulfilmentOf(fresh, sellerA);
  const fB = fulfilmentOf(fresh, sellerB);
  assert.equal(fA.refundedSubtotal, 1000);
  assert.equal(fA.status, "processing", "the seller's kept items are not cancelled");
  assert.equal(fA.payoutAmount, ctx.pricing.commissionFor(1000, fA.commissionRate).payoutAmount);
  assert.equal(fB.refundedSubtotal, 0);
});

test("a pending refund holds the package; the webhook applies it exactly once", async () => {
  const { order, sellerA } = await twoSellerOrder();
  ctx.fake.state.refundMode = "pending";
  const res = await cancelPackage(sellerA, order);
  assert.equal(res.statusCode, 200);

  let fresh = await ctx.Order.findById(order._id);
  assert.equal(fresh.refundStatus, "pending");
  assert.equal(fulfilmentOf(fresh, sellerA).refundedSubtotal, 0, "not applied until processed");

  const [refund] = await ctx.Refund.find({ order: order._id }).lean();
  const event = { id: Number(refund.reference), status: "processed", transaction_reference: refund.paymentReference };
  await ctx.payments.applyRefundWebhook(event);
  await ctx.payments.applyRefundWebhook(event); // Paystack retries webhooks

  fresh = await ctx.Order.findById(order._id);
  assert.equal(fulfilmentOf(fresh, sellerA).refundedSubtotal, 2000);
  assert.equal(fresh.refundStatus, "partial");
  const payment = await ctx.Payment.findOne({ order: order._id });
  assert.equal(payment.status, "success", "a partial refund leaves the payment successful");
});

test("reconciliation settles a refund whose webhook never arrived", async () => {
  const { order, sellerA } = await twoSellerOrder();
  ctx.fake.state.refundMode = "pending";
  await cancelPackage(sellerA, order);

  const [refund] = await ctx.Refund.find({ order: order._id }).lean();
  ctx.fake.state.refunds.get(refund.reference).status = "processed"; // Paystack has since completed it
  await ctx.Refund.collection.updateOne(
    { _id: refund._id },
    { $set: { createdAt: new Date(Date.now() - 2 * 3600 * 1000) } },
  );

  const summary = await ctx.reconcile.reconcilePendingRefunds();
  assert.equal(summary.processed, 1);
  const fresh = await ctx.Order.findById(order._id);
  assert.equal(fulfilmentOf(fresh, sellerA).refundedSubtotal, 2000);
});

test("an upheld not-received report refunds that seller's package", async () => {
  const { order, sellerB, buyer } = await twoSellerOrder();
  const dispute = await ctx.Dispute.create({
    order: order._id,
    seller: sellerB._id,
    user: buyer._id,
    reason: "Never arrived",
  });
  await ctx.refund.refundDisputedPackage(dispute);

  assert.equal(ctx.fake.state.refundCalls.length, 1);
  assert.equal(ctx.fake.state.refundCalls[0].amount, 50000);
  const fresh = await ctx.Order.findById(order._id);
  const fB = fulfilmentOf(fresh, sellerB);
  assert.equal(fB.refundedSubtotal, 500);
  assert.equal(fB.payoutAmount, 0, "an upheld package is never paid out");
});

test("no refund can exceed what was charged, even when asked for goods that are gone", async () => {
  const { order, sellerA } = await twoSellerOrder();
  await assert.rejects(
    ctx.refund.refundGoods({
      orderId: order._id,
      allocations: [{ seller: sellerA._id, gross: 99999 }],
      kind: "admin",
    }),
    (e) => e.status === 409,
  );
  assert.equal(ctx.fake.state.refundCalls.length, 0);
});

test("two simultaneous cancels of the same package refund it once", async () => {
  const { order, sellerA } = await twoSellerOrder();
  const [first, second] = await Promise.all([
    cancelPackage(sellerA, order, "Out of stock"),
    cancelPackage(sellerA, order, "Out of stock"),
  ]);
  const codes = [first.statusCode, second.statusCode].sort();
  assert.deepEqual(codes, [200, 409]);
  assert.equal(ctx.fake.state.refundCalls.length, 1, "Paystack is asked exactly once");
});
