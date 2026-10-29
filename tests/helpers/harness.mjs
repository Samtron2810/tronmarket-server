// Shared test harness for the money paths.
//
//   * a real MongoDB (mongodb-memory-server) per test file;
//   * a fake Paystack HTTP server. config/paystack.js reads PAYSTACK_BASE_URL,
//     which is set here BEFORE any app module is imported, so refunds,
//     verification and reconciliation all talk to the fake over real HTTP;
//   * seeding helpers that build paid orders the same way checkout does.
//
// Usage (in a *.test.mjs file):
//   const ctx = await bootstrap();  before(...)  /  after(() => ctx.close())
import http from "node:http";
import { randomBytes } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

export function startFakePaystack() {
  const state = {
    refundMode: "processed", // "processed" | "pending" | "reject"
    refunds: new Map(), // id -> refund data
    refundCalls: [], // every POST /refund body, in order
    transactions: new Map(), // reference -> verify data
    nextId: 1000,
  };

  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const send = (code, payload) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "POST" && req.url === "/refund") {
      state.refundCalls.push(body);
      if (state.refundMode === "reject") {
        return send(400, { status: false, message: "Transaction has already been fully refunded" });
      }
      const id = state.nextId++;
      const data = {
        id,
        status: state.refundMode,
        transaction_reference: body.transaction,
        amount: body.amount,
        currency: body.currency,
      };
      state.refunds.set(String(id), data);
      return send(200, { status: true, message: "Refund requested", data });
    }

    if (req.method === "GET" && req.url.startsWith("/refund/")) {
      const id = decodeURIComponent(req.url.slice("/refund/".length));
      const data = state.refunds.get(id);
      if (!data) return send(404, { status: false, message: "Refund not found" });
      return send(200, { status: true, data });
    }

    if (req.method === "GET" && req.url.startsWith("/transaction/verify/")) {
      const reference = decodeURIComponent(req.url.split("/").pop());
      const data = state.transactions.get(reference);
      if (!data) return send(404, { status: false, message: "Transaction reference not found" });
      return send(200, { status: true, data });
    }

    send(404, { status: false, message: `Not faked: ${req.method} ${req.url}` });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({
        url,
        state,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

export async function bootstrap() {
  const paystack = await startFakePaystack();
  process.env.PAYSTACK_BASE_URL = paystack.url;
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fake";
  process.env.PAYMENT_RECONCILIATION_SWEEPER = "false";
  process.env.ORDER_LIFECYCLE_SWEEPER = "false";

  const mongod = await MongoMemoryServer.create();
  const mongoose = (await import("mongoose")).default;
  await mongoose.connect(mongod.getUri());

  const models = {
    Order: (await import("../../models/Order.js")).default,
    Payment: (await import("../../models/Payment.js")).default,
    Refund: (await import("../../models/Refund.js")).default,
    User: (await import("../../models/User.js")).default,
    Product: (await import("../../models/Product.js")).default,
    Dispute: (await import("../../models/Dispute.js")).default,
    ReturnRequest: (await import("../../models/ReturnRequest.js")).default,
    OrderMessage: (await import("../../models/OrderMessage.js")).default,
    Payout: (await import("../../models/Payout.js")).default,
    Review: (await import("../../models/Review.js")).default,
  };
  const fulfilment = await import("../../services/orderFulfillmentService.js");
  const services = {
    refund: await import("../../services/refundService.js"),
    settle: await import("../../services/chargeSettlementService.js"),
    reconcile: await import("../../services/paymentReconciliationService.js"),
    payments: await import("../../services/paymentService.js"),
    ledger: await import("../../services/payoutLedgerService.js"),
    cancellation: await import("../../services/orderCancellationService.js"),
    lifecycle: await import("../../services/orderLifecycleService.js"),
    pricing: await import("../../services/pricingService.js"),
    fulfilment,
  };
  const controllers = {
    package: await import("../../controllers/packageController.js"),
    dispute: await import("../../controllers/disputeController.js"),
    payout: await import("../../controllers/payoutController.js"),
    messages: await import("../../controllers/messageController.js"),
    returns: await import("../../controllers/returnController.js"),
    admin: await import("../../controllers/adminOpsController.js"),
    reviews: await import("../../controllers/reviewController.js"),
  };

  async function resetDb() {
    await mongoose.connection.db.dropDatabase();
    // Indexes are rebuilt lazily; keep unique constraints (Payment.reference) working.
    await Promise.all(Object.values(models).map((m) => m.init()));
  }

  return {
    ...models,
    ...services,
    controllers,
    fake: paystack,
    resetDb,
    seed: (opts) => seedPaidOrder(models, opts),
    seedUser: (opts) => seedUser(models, opts),
    close: async () => {
      await mongoose.disconnect();
      await mongod.stop();
      await paystack.close();
    },
  };
}

export async function seedUser(models, { name, email, role = "customer" }) {
  return models.User.create({
    name,
    email,
    password: "not-used-in-tests-hashed-elsewhere",
    role,
    isVerified: true,
  });
}

// Builds a PAID order exactly like checkout does: one Product per item (raw
// insert, so the tests do not depend on catalogue validation), fulfilments
// derived from the items, and a success Payment bound to the order.
export async function seedPaidOrder(
  models,
  { buyer, items, discountAmount = 0, shippingPrice = 0, status = "processing", reference, stock = 10 },
) {
  const { Order, Payment, Product } = models;
  const { buildSellerFulfillments } = await import("../../services/orderFulfillmentService.js");
  const { getCommissionRate, money } = await import("../../services/pricingService.js");

  const orderItems = [];
  for (const item of items) {
    const { insertedId } = await Product.collection.insertOne({
      name: item.name || "Test product",
      description: "test",
      price: item.price,
      category: "Test",
      seller: item.seller,
      stock,
      hasVariants: false,
      images: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    orderItems.push({
      product: insertedId,
      name: item.name || "Test product",
      price: item.price,
      quantity: item.quantity || 1,
      seller: item.seller,
      variant: null,
      variantLabel: "",
    });
  }

  const itemsSubtotal = money(orderItems.reduce((s, i) => s + i.price * i.quantity, 0));
  const totalPrice = money(itemsSubtotal - discountAmount + shippingPrice);
  const paymentReference = reference || `TRON-TEST-${randomBytes(6).toString("hex")}`;
  const order = await Order.create({
    user: buyer._id,
    email: buyer.email,
    orderItems,
    itemsSubtotal,
    discountAmount,
    shippingPrice,
    totalPrice,
    commissionRate: getCommissionRate(),
    shippingAddress: {
      fullName: buyer.name,
      phone: "08000000000",
      address: "1 Test Street",
      city: "Port Harcourt",
      state: "Rivers",
    },
    status,
    isPaid: true,
    paidAt: new Date(),
    paymentReference,
    paymentStatus: "paid",
    sellerFulfillments: buildSellerFulfillments(orderItems, status),
  });
  const payment = await Payment.create({
    order: order._id,
    user: buyer._id,
    amount: totalPrice,
    currency: "NGN",
    reference: paymentReference,
    status: "success",
    paidAt: new Date(),
  });
  return { order, payment, reference: paymentReference };
}

// Minimal Express-like response for calling controllers directly.
export function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
  };
}

export const kobo = (naira) => Math.round(Number(naira) * 100);
