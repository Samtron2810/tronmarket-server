// Marketplace timing rules for the order lifecycle, in days. Each can be
// overridden by an env var so ops can tune them without a deploy.
//
//   shipDeadlineDays     paid order not shipped in time      → auto-cancel + refund
//   deliveryConfirmDays  seller marked delivered, buyer silent → auto-confirmed
//   disputeWindowDays    "not received" can be reported for this long after
//                        delivery, and seller payouts are released only after it
//   autoCompleteDays     delivered, undisputed → completed (never sooner than
//                        the dispute window)
//   returnWindowDays     buyer may request a return for this long after delivery

const DAY_MS = 24 * 60 * 60 * 1000;

function days(envName, fallback) {
  const parsed = Number.parseInt(process.env[envName], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const POLICY = Object.freeze({
  shipDeadlineDays: days("SHIP_DEADLINE_DAYS", 7),
  deliveryConfirmDays: days("DELIVERY_CONFIRM_DAYS", 7),
  disputeWindowDays: days("DISPUTE_WINDOW_DAYS", 7),
  autoCompleteDays: days("AUTO_COMPLETE_DAYS", 7),
  returnWindowDays: days("RETURN_WINDOW_DAYS", 7),
});

export function addDays(date, count) {
  return new Date(new Date(date).getTime() + count * DAY_MS);
}

export function daysBefore(now, count) {
  return new Date(now.getTime() - count * DAY_MS);
}
