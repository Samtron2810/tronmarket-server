// One-off: mark unpaid delivered fulfilments created before the payout ledger
// as "legacyManual". The ledger then never claims them; the operator pays them
// by hand and the amounts are reported per seller as legacyManual.
//
// Dry run by default. Nothing is written without --apply.
//   MONGO_URI=... node scripts/markLegacyManual.mjs --before=2026-10-22T00:00:00Z
//   MONGO_URI=... node scripts/markLegacyManual.mjs --before=2026-10-22T00:00:00Z --apply
import dotenv from "dotenv";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import { SETTLEABLE } from "../services/payoutLedgerService.js";

dotenv.config();

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const apply = process.argv.includes("--apply");
const before = new Date(arg("before") || "");

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set.");
  process.exit(1);
}
if (Number.isNaN(before.getTime())) {
  console.error("Pass --before=<ISO date>, the date the payout ledger went live.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);

const candidates = { "sellerFulfillments.status": { $in: SETTLEABLE }, "sellerFulfillments.payoutId": null, "sellerFulfillments.legacyManual": { $ne: true } };
const orderFilter = { createdAt: { $lt: before }, ...candidates };

const summary = await Order.aggregate([
  { $match: orderFilter },
  { $unwind: "$sellerFulfillments" },
  { $match: { "sellerFulfillments.status": { $in: SETTLEABLE }, "sellerFulfillments.payoutId": null, "sellerFulfillments.legacyManual": { $ne: true } } },
  { $group: { _id: "$sellerFulfillments.seller", fulfilments: { $sum: 1 }, amount: { $sum: "$sellerFulfillments.payoutAmount" } } },
]);

console.log(`Cutoff: orders created before ${before.toISOString()}`);
for (const row of summary) console.log(`  seller ${row._id}: ${row.fulfilments} fulfilment(s), ${row.amount} naira`);
console.log(`Total: ${summary.reduce((s, r) => s + r.fulfilments, 0)} fulfilment(s).`);

if (apply) {
  const res = await Order.updateMany(orderFilter, {
    $set: { "sellerFulfillments.$[f].legacyManual": true },
  }, {
    arrayFilters: [{ "f.status": { $in: SETTLEABLE }, "f.payoutId": null, "f.legacyManual": { $ne: true } }],
  });
  console.log(`Applied: ${res.modifiedCount} order(s) updated.`);
} else {
  console.log("Dry run. Re-run with --apply to write.");
}

await mongoose.disconnect();
