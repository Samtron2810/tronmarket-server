// Pure ledger classification: which fulfilments are held, refunded or payable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLedger } from "../services/payoutLedgerService.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const O = "oooooooooooooooooooooooo";
const now = new Date("2026-10-22T12:00:00Z");
const longAgo = new Date("2026-10-01T00:00:00Z");

function order(overrides = {}) {
  return {
    _id: O,
    status: "delivered",
    refundStatus: "none",
    deliveredAt: longAgo,
    createdAt: longAgo,
    updatedAt: longAgo,
    sellerFulfillments: [
      { seller: A, status: "delivered", payoutAmount: 900, deliveredAt: longAgo },
      { seller: B, status: "delivered", payoutAmount: 400, deliveredAt: longAgo },
    ],
    ...overrides,
  };
}

test("an open return holds only the sellers it names", () => {
  const { claims, sellers } = classifyLedger({
    orders: [order()],
    returns: [{ order: O, status: "requested", sellers: [A] }],
    now,
  });
  const a = sellers.find((s) => s.seller === A);
  const b = sellers.find((s) => s.seller === B);
  assert.equal(a.held, 900);
  assert.equal(a.payable, 0);
  assert.equal(b.payable, 400);
  assert.deepEqual(claims.map((c) => c.seller), [B]);
});

test("a refunded return no longer holds anything", () => {
  const { claims } = classifyLedger({
    orders: [order({ refundStatus: "partial" })],
    returns: [{ order: O, status: "refunded", sellers: [A] }],
    now,
  });
  assert.equal(claims.length, 2);
});

test("a zero net amount (fully refunded package) is never claimed", () => {
  const { claims, sellers } = classifyLedger({
    orders: [order({ refundStatus: "partial", sellerFulfillments: [
      { seller: A, status: "delivered", payoutAmount: 0, deliveredAt: longAgo },
      { seller: B, status: "delivered", payoutAmount: 400, deliveredAt: longAgo },
    ] })],
    now,
  });
  assert.deepEqual(claims.map((c) => c.seller), [B]);
  assert.equal(sellers.find((s) => s.seller === A).payable, 0);
});

test("a package inside the dispute window is pending, not payable", () => {
  const recent = new Date("2026-10-20T00:00:00Z");
  const { claims, sellers } = classifyLedger({
    orders: [order({ sellerFulfillments: [
      { seller: A, status: "delivered", payoutAmount: 900, deliveredAt: recent },
    ] })],
    now,
  });
  assert.equal(claims.length, 0);
  assert.equal(sellers[0].pendingRelease, 900);
});

test("a legacy fulfilment marked manual is never claimed and is reported separately", () => {
  const legacy = order({ sellerFulfillments: [
    { seller: A, status: "delivered", payoutAmount: 900, deliveredAt: longAgo, legacyManual: true },
    { seller: B, status: "delivered", payoutAmount: 400, deliveredAt: longAgo },
  ] });
  const { claims, sellers } = classifyLedger({ orders: [legacy], now });
  assert.deepEqual(claims.map((c) => c.seller), [B]);
  const a = sellers.find((s) => s.seller === A);
  assert.equal(a.legacyManual, 900);
  assert.equal(a.payable, 0);
  assert.equal(a.earned, 0);
});
