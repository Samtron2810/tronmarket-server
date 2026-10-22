// Return timing and shape: only delivered orders, only inside the return
// window, one open return at a time, and the buyer's details are kept.
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
});

const DAY = 24 * 3600 * 1000;

async function deliveredOrder({ deliveredDaysAgo = 0 } = {}) {
  const buyer = await ctx.seedUser({ name: "Ada", email: "ada@example.com" });
  const seller = await ctx.seedUser({ name: "Seller", email: "s@example.com", role: "seller" });
  const { order } = await ctx.seed({
    buyer,
    status: "delivered",
    items: [{ seller: seller._id, price: 1000, quantity: 2, name: "Shirt" }],
  });
  const at = new Date(Date.now() - deliveredDaysAgo * DAY);
  await ctx.Order.collection.updateOne(
    { _id: order._id },
    { $set: { deliveredAt: at, updatedAt: at, "sellerFulfillments.$[].deliveredAt": at, "sellerFulfillments.$[].status": "delivered", status: "delivered" } },
  );
  return { buyer, seller, order: await ctx.Order.findById(order._id).lean() };
}

test("a return is refused until the order is delivered", async () => {
  const buyer = await ctx.seedUser({ name: "Ada", email: "ada@example.com" });
  const seller = await ctx.seedUser({ name: "Seller", email: "s@example.com", role: "seller" });
  const { order } = await ctx.seed({ buyer, items: [{ seller: seller._id, price: 1000, name: "Shirt" }] });
  const res = fakeRes();
  await ctx.controllers.returns.createReturnRequest(
    { params: { orderId: String(order._id) }, user: { _id: buyer._id }, body: { reason: "x" } },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /once the order is delivered/);
});

test("a return is refused after the return window closes", async () => {
  const { buyer, order } = await deliveredOrder({ deliveredDaysAgo: 8 });
  const res = fakeRes();
  await ctx.controllers.returns.createReturnRequest(
    {
      params: { orderId: String(order._id) },
      user: { _id: buyer._id },
      body: { reason: "Wrong size", items: [{ product: String(order.orderItems[0].product), quantity: 1 }] },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /within 7 days of delivery/);
  assert.equal(await ctx.ReturnRequest.countDocuments({ order: order._id }), 0);
});

test("a return inside the window is created with its lines, sellers and details", async () => {
  const { buyer, seller, order } = await deliveredOrder({ deliveredDaysAgo: 2 });
  const res = fakeRes();
  await ctx.controllers.returns.createReturnRequest(
    {
      params: { orderId: String(order._id) },
      user: { _id: buyer._id },
      body: { reason: "Wrong size", details: "Too small, unworn", items: [{ product: String(order.orderItems[0].product), quantity: 1 }] },
    },
    res,
  );
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const saved = await ctx.ReturnRequest.findOne({ order: order._id }).lean();
  assert.equal(saved.status, "requested");
  assert.equal(saved.details, "Too small, unworn");
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].quantity, 1);
  assert.deepEqual(saved.sellers.map(String), [String(seller._id)]);
});

test("only one open return per order", async () => {
  const { buyer, order } = await deliveredOrder({ deliveredDaysAgo: 1 });
  const first = fakeRes();
  await ctx.controllers.returns.createReturnRequest(
    { params: { orderId: String(order._id) }, user: { _id: buyer._id }, body: { reason: "a", items: [{ product: String(order.orderItems[0].product), quantity: 1 }] } },
    first,
  );
  assert.equal(first.statusCode, 201);
  const second = fakeRes();
  await ctx.controllers.returns.createReturnRequest(
    { params: { orderId: String(order._id) }, user: { _id: buyer._id }, body: { reason: "b", items: [{ product: String(order.orderItems[0].product), quantity: 1 }] } },
    second,
  );
  assert.equal(second.statusCode, 409);
  assert.match(second.body.message, /already open/);
});
