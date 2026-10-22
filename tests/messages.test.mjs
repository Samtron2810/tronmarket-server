// Buyer <-> seller messaging: one thread per (order, seller), with access rules.
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
});

async function setup({ paid = true } = {}) {
  const buyer = await seedUser(ctx, { name: "Ada", email: "ada@example.com" });
  const sellerA = await seedUser(ctx, { name: "A", email: "a@example.com", role: "seller" });
  const sellerB = await seedUser(ctx, { name: "B", email: "b@example.com", role: "seller" });
  const stranger = await seedUser(ctx, { name: "Eve", email: "eve@example.com" });
  const admin = await seedUser(ctx, { name: "Admin", email: "admin@example.com", role: "admin" });
  const { order } = await ctx.seed({
    buyer,
    items: [{ seller: sellerA._id, price: 1000, quantity: 1 }, { seller: sellerB._id, price: 500, quantity: 1 }],
  });
  if (!paid) {
    await ctx.Order.collection.updateOne({ _id: order._id }, { $set: { isPaid: false, status: "pending" } });
  }
  return { buyer, sellerA, sellerB, stranger, admin, orderId: String(order._id) };
}

const read = (user, orderId, sellerId) =>
  ctx.controllers.messages.getOrderThread({ user, params: { orderId }, query: { sellerId } }, fakeRes());

test("each seller has a separate thread with the buyer; sellers never see each other's", async () => {
  const { buyer, sellerA, sellerB, orderId } = await setup();
  const posted = fakeRes();
  await ctx.controllers.messages.postOrderMessage(
    { user: buyer, params: { orderId }, body: { body: "Is the shirt in blue?", sellerId: String(sellerA._id) } },
    posted,
  );
  assert.equal(posted.statusCode, 201, JSON.stringify(posted.body));

  const aView = fakeRes();
  await ctx.controllers.messages.getOrderThread({ user: sellerA, params: { orderId }, query: {} }, aView);
  assert.equal(aView.statusCode, 200);
  assert.equal(aView.body.messages.length, 1);
  assert.equal(aView.body.messages[0].senderRole, "buyer");

  const bView = fakeRes();
  await ctx.controllers.messages.getOrderThread({ user: sellerB, params: { orderId }, query: {} }, bView);
  assert.equal(bView.body.messages.length, 0, "seller B does not see seller A's conversation");
});

test("the buyer cannot message a seller who is not on the order", async () => {
  const { buyer, orderId, stranger } = await setup();
  const out = fakeRes();
  await ctx.controllers.messages.postOrderMessage(
    { user: buyer, params: { orderId }, body: { body: "hello", sellerId: String(stranger._id) } },
    out,
  );
  assert.equal(out.statusCode, 400);
});

test("a stranger cannot read or write an order's messages", async () => {
  const { stranger, orderId } = await setup();
  const out = fakeRes();
  await ctx.controllers.messages.getOrderThread({ user: stranger, params: { orderId }, query: { sellerId: "000000000000000000000001" } }, out);
  assert.equal(out.statusCode, 403);
});

test("messages open only once the order is paid", async () => {
  const { buyer, sellerA, orderId } = await setup({ paid: false });
  const out = fakeRes();
  await ctx.controllers.messages.postOrderMessage(
    { user: buyer, params: { orderId }, body: { body: "hi", sellerId: String(sellerA._id) } },
    out,
  );
  assert.equal(out.statusCode, 409);
});

test("an admin can read any seller's thread on an order", async () => {
  const { buyer, sellerA, admin, orderId } = await setup();
  await ctx.controllers.messages.postOrderMessage(
    { user: buyer, params: { orderId }, body: { body: "where is my parcel?", sellerId: String(sellerA._id) } },
    fakeRes(),
  );
  const out = fakeRes();
  await ctx.controllers.messages.getOrderThread({ user: admin, params: { orderId }, query: { sellerId: String(sellerA._id) } }, out);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.messages.length, 1);
});
