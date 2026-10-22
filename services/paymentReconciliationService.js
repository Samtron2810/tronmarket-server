// ─── Paystack reconciliation ────────────────────────────────────────────────
// Webhooks are not guaranteed to arrive. Without this sweeper, a buyer who
// paid and closed the tab before the browser verify call would sit on a
// "pending" payment forever, and a refund that never reported back would stay
// "pending" forever. Every few minutes this asks Paystack directly:
//   * pending Payment rows older than the grace period are verified and
//     settled through the same rules as a webhook;
//   * pending Refund rows are re-read from Paystack and moved to their real state.
// Payments still unpaid after ABANDON_AFTER_HOURS are marked failed.
import paystackApi from "../config/paystack.js";
import Payment from "../models/Payment.js";
import Refund from "../models/Refund.js";
import { settleChargeSuccess } from "./chargeSettlementService.js";
import { applyProviderRefundStatus } from "./refundService.js";

const PAYMENT_GRACE_MINUTES = Number(process.env.PAYMENT_RECONCILE_AFTER_MINUTES) || 15;
const REFUND_GRACE_MINUTES = Number(process.env.REFUND_RECONCILE_AFTER_MINUTES) || 30;
const ABANDON_AFTER_HOURS = Number(process.env.PAYMENT_ABANDON_AFTER_HOURS) || 24;

const minutesAgo = (now, minutes) => new Date(now.getTime() - minutes * 60 * 1000);

async function fetchTransaction(reference) {
  try {
    const response = await paystackApi.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!response.data?.status) return null;
    return response.data.data || null;
  } catch (error) {
    // Paystack has never heard of this reference (the initialise call failed).
    if (error.response?.status === 404) return null;
    throw error;
  }
}

export async function reconcilePendingPayments({ now = new Date(), limit = 50 } = {}) {
  const summary = { checked: 0, settled: 0, abandoned: 0, untouched: 0, errors: 0 };
  const payments = await Payment.find({
    status: "pending",
    createdAt: { $lte: minutesAgo(now, PAYMENT_GRACE_MINUTES) },
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  for (const payment of payments) {
    summary.checked += 1;
    try {
      const data = await fetchTransaction(payment.reference);
      if (data && ["success", "failed"].includes(data.status)) {
        await settleChargeSuccess({ ...data, reference: data.reference || payment.reference }, {
          source: "reconcile",
        });
        summary.settled += 1;
      } else if (now.getTime() - new Date(payment.createdAt).getTime() > ABANDON_AFTER_HOURS * 3600 * 1000) {
        payment.status = "failed";
        await payment.save();
        summary.abandoned += 1;
      } else {
        summary.untouched += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error("reconcile: payment", payment.reference, error.message);
    }
  }
  return summary;
}

export async function reconcilePendingRefunds({ now = new Date(), limit = 50 } = {}) {
  const summary = { checked: 0, processed: 0, failed: 0, stillPending: 0, errors: 0 };
  const refunds = await Refund.find({
    status: "pending",
    reference: { $ne: "" },
    createdAt: { $lte: minutesAgo(now, REFUND_GRACE_MINUTES) },
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  for (const refund of refunds) {
    summary.checked += 1;
    try {
      const response = await paystackApi.get(`/refund/${encodeURIComponent(refund.reference)}`);
      const data = response.data?.data;
      if (!response.data?.status || !data) {
        summary.stillPending += 1;
        continue;
      }
      const before = refund.status;
      await applyProviderRefundStatus(refund, data);
      const after = (await Refund.findById(refund._id).lean())?.status || before;
      if (after === "processed") summary.processed += 1;
      else if (after === "failed") summary.failed += 1;
      else summary.stillPending += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("reconcile: refund", refund.reference, error.message);
    }
  }
  return summary;
}

let sweeperTimer = null;
let running = false;

export function startPaymentReconciliationSweeper() {
  if (
    sweeperTimer ||
    process.env.PAYMENT_RECONCILIATION_SWEEPER === "false" ||
    !process.env.PAYSTACK_SECRET_KEY
  ) {
    return null;
  }

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const payments = await reconcilePendingPayments();
      const refunds = await reconcilePendingRefunds();
      const acted = payments.settled + payments.abandoned + refunds.processed + refunds.failed;
      if (acted || payments.errors || refunds.errors) {
        console.log("Payment reconciliation:", { payments, refunds });
      }
    } catch (error) {
      console.error("Payment reconciliation failed:", error.message);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 60 * 1000);
  sweeperTimer = setInterval(run, 10 * 60 * 1000);
  sweeperTimer.unref?.();
  return sweeperTimer;
}
