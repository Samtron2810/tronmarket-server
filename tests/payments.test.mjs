// Payment money path: settling charges from the webhook / reconciliation sweep,
// flagging charges that cannot pay for an order, and refunding those.
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
  ctx.fake.state.transactions.clear();
});

const HOURS = 3600 * 1000;

// An order the buyer has NOT paid yet, with a pending Payment row created
// `ageHours` ago (the normal state after /payments/initialize).
async function seedUnpaid({ buyer, seller, ageHours = 1 }) {
  const { buildSellerFulfillments } = await import("../services/orderFulfillmentService.js");
  const { getCommissionRate, money } = await import("../services/pricingService.js");
  const { randomBytes } = await import("node:crypto");
  const { insertedId } = await ctx.Product.collection.insertOne({
    name: "Bag", description: "t", price: 800, category: "Test", seller: seller._id, stock: 5,
    hasVariants: false, images: [], createdAt: new Date(), updatedAt: new Date(),
  });
  const orderItems = [{ product: insertedId, name: "Bag", price: 800, quantity: 1, seller: seller._id, variant: null, variantLabel: "" }];
  const reference = `TRON-TEST-${randomBytes(6).toString("hex")}`;
  const order = await ctx.Order.create({
    user: buyer._id, email: buyer.email, orderItems, itemsSubtotal: 800, totalPrice: money(800),
    commissionRate: getCommissionRate(), status: "pending", isPaid: false, paymentReference: reference,
    shippingAddress: { fullName: "A", phone: "1", address: "x", city: "PH", state: "Rivers" },
    sellerFulfillments: buildSellerFulfillments(orderItems, "pending"),
  });
  const createdAt = new Date(Date.now() - ageHours * HOURS);
  const payment = await ctx.Payment.create({
    order: order._id, user: buyer._id, amount: 800, currency: "NGN", reference, status: "pending",
  });
  await ctx.Payment.collection.updateOne({ _id: payment._id }, { $set: { createdAt } });
  return { order, payment, reference };
}

const successData = (order, reference, overrides = {}) => ({
  status: "success",
  reference,
  amount: 80000,
  currency: "NGN",
  metadata: { orderId: String(order._id) },
  customer: { email: "ada@example.com" },
  paid_at: new Date().toISOString(),
  ...overrides,
});

async function buyerAndSeller() {
  const buyer = await seedUser(ctx, { name: "Ada", email: "ada@example.com" });
  const seller = await seedUser(ctx, { name: "Seller", email: "s@example.com", role: "seller" });
  return { buyer, seller };
}

test("reconciliation settles a payment whose webhook never arrived", async () => {
  const { buyer, seller } = await buyerAndSeller();
  const { order, reference } = await seedUnpaid({ buyer, seller, ageHours: 1 });
  ctx.fake.state.transactions.set(reference, successData(order, reference));

  const summary = await ctx.reconcile.reconcilePendingPayments();
  assert.equal(summary.settled, 1);

  const fresh = await ctx.Order.findById(order._id);
  assert.equal(fresh.isPaid, true);
  assert.equal(fresh.paymentReference, reference);
  const payment = await ctx.Payment.findOne({ reference });
  assert.equal(payment.status, "success");
  assert.equal(await ctx.Refund.countDocuments({ order: order._id }), 0, "a correct payment is never refunded");
});

test("a payment in the grace period is left alone", async () => {
  const { buyer, seller } = await buyerAndSeller();
  const { order, reference } = await seedUnpaid({ buyer, seller, ageHours: 0.01 });
  ctx.fake.state.transactions.set(reference, successData(order, reference));
  const summary = await ctx.reconcile.reconcilePendingPayments();
  assert.equal(summary.checked, 0, "too recent to be checked");
  assert.equal((await ctx.Order.findById(order._id)).isPaid, false);
});

test("a charge with the wrong amount is flagged, refunded, and never marks the order paid", async () => {
  const { buyer, seller } = await buyerAndSeller();
  const { order, reference } = await seedUnpaid({ buyer, seller, ageHours: 1 });
  ctx.fake.state.transactions.set(reference, successData(order, reference, { amount: 70000 }));

  await ctx.reconcile.reconcilePendingPayments();

  const fresh = await ctx.Order.findById(order._id);
  assert.equal(fresh.isPaid, false);
  assert.equal(fresh.status, "pending");
  const refunds = await ctx.Refund.find({ order: order._id }).lean();
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].kind, "charge-mismatch");
  assert.equal(refunds[0].status, "processed");
  assert.equal(ctx.fake.state.refundCalls[0].amount, 70000, "the money actually taken goes back");
  assert.equal(fresh.refundStatus, "none", "the order's own refund state is untouched");
});

test("a second successful charge on a paid order is refunded and the order is untouched", async () => {
  const { buyer, seller } = await buyerAndSeller();
  const { order, reference: firstRef } = await seedUnpaid({ buyer, seller, ageHours: 1 });
  ctx.fake.state.transactions.set(firstRef, successData(order, firstRef));
  await ctx.reconcile.reconcilePendingPayments();
  assert.equal((await ctx.Order.findById(order._id)).isPaid, true);

  // The buyer pays again with a new reference (double tap, second tab).
  const duplicateRef = "TRON-DUP-0001";
  await ctx.Payment.create({
    order: order._id, user: buyer._id, amount: 800, currency: "NGN", reference: duplicateRef, status: "pending",
  });
  await ctx.Payment.collection.updateOne(
    { reference: duplicateRef },
    { $set: { createdAt: new Date(Date.now() - 2 * HOURS) } },
  );
  ctx.fake.state.transactions.set(duplicateRef, successData(order, duplicateRef));
  await ctx.reconcile.reconcilePendingPayments();

  const fresh = await ctx.Order.findById(order._id);
  assert.equal(fresh.paymentReference, firstRef, "the first payment still pays for the order");
  assert.equal(fresh.refundStatus, "none");
  const dup = await ctx.Refund.findOne({ paymentReference: duplicateRef }).lean();
  assert.equal(dup?.status, "processed");
  assert.equal(dup?.kind, "charge-mismatch");
});

test("a pending payment Paystack never saw is marked failed after the abandon window", async () => {
  const { buyer, seller } = await buyerAndSeller();
  const { order, reference } = await seedUnpaid({ buyer, seller, ageHours: 25 });
  // No transaction in the fake: verify returns 404, as Paystack does.
  const summary = await ctx.reconcile.reconcilePendingPayments();
  assert.equal(summary.abandoned, 1);
  assert.equal((await ctx.Payment.findOne({ reference })).status, "failed");
  assert.equal((await ctx.Order.findById(order._id)).isPaid, false);
});

test("settling the same successful charge twice pays the order once", async () => {
  const { buyer, seller } = await buyerAndSeller();
  const { order, reference } = await seedUnpaid({ buyer, seller, ageHours: 1 });
  const data = successData(order, reference);
  const [a, b] = await Promise.all([
    ctx.settle.settleChargeSuccess(data, { source: "webhook" }),
    ctx.settle.settleChargeSuccess(data, { source: "reconcile" }),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["already-paid", "paid"]);
  assert.equal(await ctx.Refund.countDocuments({ order: order._id }), 0);
});
