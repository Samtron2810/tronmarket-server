// Review gate: only buyers with a delivered (or completed) package containing
// the product can post. Review text is saved and read back.
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

async function setup() {
  const buyer = await ctx.seedUser({ name: "Ada", email: "ada@example.com" });
  const stranger = await ctx.seedUser({ name: "Tope", email: "tope@example.com" });
  const seller = await ctx.seedUser({ name: "Seller", email: "s@example.com", role: "seller" });
  const { order } = await ctx.seed({
    buyer,
    status: "processing",
    items: [{ seller: seller._id, price: 1000, name: "Shirt" }],
  });
  const productId = String(order.orderItems[0].product);
  return { buyer, stranger, seller, order, productId };
}

async function setPackageStatus(orderId, status) {
  await ctx.Order.collection.updateOne(
    { _id: orderId },
    { $set: { "sellerFulfillments.$[].status": status, status } },
  );
}

const post = (productId, user, body = { rating: 4, title: "Good", body: "Fits well" }) => {
  const res = fakeRes();
  return ctx.controllers.reviews
    .createOrUpdateReview({ params: { id: productId }, user: { _id: user._id }, body }, res)
    .then(() => res);
};

test("a user with no order for the product cannot review it", async () => {
  const { stranger, productId } = await setup();
  const res = await post(productId, stranger);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /delivered order for this product/);
  assert.equal(await ctx.Review.countDocuments({ product: productId }), 0);
});

test("a buyer whose package is still processing cannot review", async () => {
  const { buyer, productId } = await setup();
  const res = await post(productId, buyer);
  assert.equal(res.statusCode, 403);
  assert.equal(await ctx.Review.countDocuments({ product: productId }), 0);
});

test("a buyer whose package was cancelled cannot review", async () => {
  const { buyer, order, productId } = await setup();
  await setPackageStatus(order._id, "cancelled");
  const res = await post(productId, buyer);
  assert.equal(res.statusCode, 403);
});

test("a delivered package lets the buyer review, and the text is saved", async () => {
  const { buyer, order, productId } = await setup();
  await setPackageStatus(order._id, "delivered");
  const res = await post(productId, buyer);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.body, "Fits well");
  assert.equal(res.body.verifiedPurchase, true);
  const saved = await ctx.Review.findOne({ product: productId }).lean();
  assert.equal(saved.body, "Fits well");
});

test("a completed package also lets the buyer review", async () => {
  const { buyer, order, productId } = await setup();
  await setPackageStatus(order._id, "completed");
  const res = await post(productId, buyer);
  assert.equal(res.statusCode, 201);
});

test("a delivered order for another product does not unlock this one", async () => {
  const { buyer, order, productId, seller } = await setup();
  await setPackageStatus(order._id, "delivered");
  // A second product the buyer has only ordered, not received.
  const other = await ctx.seed({
    buyer,
    status: "processing",
    items: [{ seller: seller._id, price: 500, name: "Cap" }],
  });
  const otherId = String(other.order.orderItems[0].product);
  const res = await post(otherId, buyer);
  assert.equal(res.statusCode, 403);
  // The original product is still reviewable.
  assert.equal((await post(productId, buyer)).statusCode, 201);
});

test("the eligibility check agrees with the posting gate", async () => {
  const { buyer, stranger, order, productId } = await setup();
  const check = async (user) => {
    const res = fakeRes();
    await ctx.controllers.reviews.reviewEligibility({ params: { id: productId }, user: { _id: user._id } }, res);
    return res.body.canReview;
  };
  assert.equal(await check(buyer), false);
  assert.equal(await check(stranger), false);
  await setPackageStatus(order._id, "delivered");
  assert.equal(await check(buyer), true);
  assert.equal(await check(stranger), false);
});

test("reviews saved under the old 'comment' field still show their text", async () => {
  const { buyer, productId } = await setup();
  await ctx.Review.collection.insertOne({
    product: (await ctx.Product.findById(productId).lean())._id,
    user: buyer._id,
    rating: 5,
    title: "Old",
    comment: "Saved before the rename",
    verifiedPurchase: false,
    isHidden: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const res = fakeRes();
  await ctx.controllers.reviews.listProductReviews({ params: { id: productId } }, res);
  assert.equal(res.body.reviews[0].body, "Saved before the rename");
});
