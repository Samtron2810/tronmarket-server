// Admin review moderation: hiding removes a review from the storefront and the
// rating, the author cannot undo it, showing and deleting recalculate the rating,
// and every action is audited. Non-admins are refused.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, fakeRes } from "./helpers/harness.mjs";

let ctx;
let AuditLog;
before(async () => {
  ctx = await bootstrap();
  AuditLog = (await import("../models/AuditLog.js")).default;
});
after(async () => {
  await ctx?.close();
});
beforeEach(async () => {
  await ctx.resetDb();
});

async function setup() {
  const buyer = await ctx.seedUser({ name: "Ada", email: "ada@example.com" });
  const buyer2 = await ctx.seedUser({ name: "Tope", email: "tope@example.com" });
  const admin = await ctx.seedUser({ name: "Admin", email: "admin@example.com", role: "admin" });
  const seller = await ctx.seedUser({ name: "Seller", email: "s@example.com", role: "seller" });
  const { order } = await ctx.seed({ buyer, status: "delivered", items: [{ seller: seller._id, price: 1000, name: "Shirt" }] });
  const second = await ctx.seed({ buyer: buyer2, status: "delivered", items: [{ seller: seller._id, price: 1000, name: "Shirt" }] });
  const productId = String(order.orderItems[0].product);
  // seed() creates a fresh product each time; point buyer 2's line at the same one.
  await ctx.Order.collection.updateOne(
    { _id: second.order._id },
    { $set: { "orderItems.0.product": order.orderItems[0].product } },
  );
  await ctx.Order.collection.updateMany(
    { _id: { $in: [order._id, second.order._id] } },
    { $set: { "sellerFulfillments.$[].status": "delivered", status: "delivered" } },
  );
  // Two buyers review: 5 and 1 stars, average 3.
  const r1 = await postReview(productId, buyer, 5);
  const r2 = await postReview(productId, buyer2, 1);
  return { admin, buyer, buyer2, productId, r1: r1.body, r2: r2.body };
}

function postReview(productId, user, rating) {
  const res = fakeRes();
  return ctx.controllers.reviews
    .createOrUpdateReview({ params: { id: productId }, user: { _id: user._id }, body: { rating, title: "t", body: "b" } }, res)
    .then(() => res);
}

const adminReq = (admin, extra = {}) => ({ user: { _id: admin._id, role: "admin", email: admin.email }, ip: "127.0.0.1", ...extra });

async function publicSummary(productId) {
  const res = fakeRes();
  await ctx.controllers.reviews.listProductReviews({ params: { id: productId } }, res);
  return res.body;
}

async function productRating(productId) {
  const p = await ctx.Product.findById(productId).lean();
  return { rating: p.rating, numReviews: p.numReviews };
}

test("hiding a review removes it from the storefront and from the rating", async () => {
  const { admin, productId, r2 } = await setup();
  assert.deepEqual(await productRating(productId), { rating: 3, numReviews: 2 });

  const res = fakeRes();
  await ctx.controllers.adminReviews.setReviewHidden(
    { ...adminReq(admin), params: { id: String(r2._id) }, body: { hidden: true, reason: "Spam" } },
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const summary = await publicSummary(productId);
  assert.equal(summary.reviews.length, 1);
  assert.equal(summary.summary.count, 1);
  assert.equal(summary.summary.average, 5);
  assert.deepEqual(await productRating(productId), { rating: 5, numReviews: 1 });
});

test("the author cannot change a review that moderation hid", async () => {
  const { admin, buyer2, productId, r2 } = await setup();
  await ctx.controllers.adminReviews.setReviewHidden(
    { ...adminReq(admin), params: { id: String(r2._id) }, body: { hidden: true, reason: "Abuse" } },
    fakeRes(),
  );
  const res = await postReview(productId, buyer2, 4);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /removed by moderation/);
  const saved = await ctx.Review.findById(r2._id).lean();
  assert.equal(saved.isHidden, true);
  assert.equal(saved.rating, 1, "the rating must not change");
});

test("showing a hidden review again restores it and the rating", async () => {
  const { admin, productId, r2 } = await setup();
  const hide = fakeRes();
  await ctx.controllers.adminReviews.setReviewHidden({ ...adminReq(admin), params: { id: String(r2._id) }, body: { hidden: true } }, hide);
  const show = fakeRes();
  await ctx.controllers.adminReviews.setReviewHidden({ ...adminReq(admin), params: { id: String(r2._id) }, body: { hidden: false } }, show);
  assert.equal(show.statusCode, 200);
  assert.equal((await publicSummary(productId)).summary.count, 2);
  assert.deepEqual(await productRating(productId), { rating: 3, numReviews: 2 });
});

test("deleting a review removes it and recalculates the rating", async () => {
  const { admin, productId, r1 } = await setup();
  const res = fakeRes();
  await ctx.controllers.adminReviews.deleteAdminReview({ ...adminReq(admin), params: { id: String(r1._id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(await ctx.Review.countDocuments({ _id: r1._id }), 0);
  assert.deepEqual(await productRating(productId), { rating: 1, numReviews: 1 });
});

test("the admin list can filter hidden reviews and includes the product and reviewer", async () => {
  const { admin, r2 } = await setup();
  await ctx.controllers.adminReviews.setReviewHidden({ ...adminReq(admin), params: { id: String(r2._id) }, body: { hidden: true, reason: "Spam" } }, fakeRes());
  const hidden = fakeRes();
  await ctx.controllers.adminReviews.listAdminReviews({ query: { status: "hidden" } }, hidden);
  assert.equal(hidden.body.reviews.length, 1);
  assert.equal(hidden.body.reviews[0].moderationReason, "Spam");
  assert.equal(hidden.body.reviews[0].user.email, "tope@example.com");
  assert.equal(hidden.body.reviews[0].product.name, "Shirt");

  const visible = fakeRes();
  await ctx.controllers.adminReviews.listAdminReviews({ query: { status: "visible" } }, visible);
  assert.equal(visible.body.reviews.length, 1);
});

test("moderation actions are written to the audit log", async () => {
  const { admin, r2 } = await setup();
  await ctx.controllers.adminReviews.setReviewHidden({ ...adminReq(admin), params: { id: String(r2._id) }, body: { hidden: true, reason: "Spam" } }, fakeRes());
  await ctx.controllers.adminReviews.deleteAdminReview({ ...adminReq(admin), params: { id: String(r2._id) } }, fakeRes());
  const actions = (await AuditLog.find({ targetId: String(r2._id) }).lean()).map((row) => row.action).sort();
  assert.deepEqual(actions, ["review.delete", "review.hide"]);
});

test("a bad request is refused: 'hidden' must be a boolean and the review must exist", async () => {
  const { admin, r2 } = await setup();
  const bad = fakeRes();
  await ctx.controllers.adminReviews.setReviewHidden({ ...adminReq(admin), params: { id: String(r2._id) }, body: { hidden: "yes" } }, bad);
  assert.equal(bad.statusCode, 400);
  const missing = fakeRes();
  await ctx.controllers.adminReviews.setReviewHidden(
    { ...adminReq(admin), params: { id: "000000000000000000000099" }, body: { hidden: true } },
    missing,
  );
  assert.equal(missing.statusCode, 404);
});

test("only admins pass the admin gate", async () => {
  const { buyer } = await setup();
  const { adminOnly } = await import("../middlewares/authMiddleware.js");
  const res = fakeRes();
  let passed = false;
  adminOnly({ user: { _id: buyer._id, role: "customer" } }, res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});
