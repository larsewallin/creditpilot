/**
 * @skill analyse-payment-behaviour
 * @type analytical
 * @description Analyses a customer's payment transaction history to derive behavioural
 *   metrics: on-time rate, average days early/late, trend, and an overall health signal.
 *   All numeric metrics are amount-weighted so large invoices influence results more
 *   than small ones. Trend compares amount-weighted halves of the transaction history.
 *   Trend threshold: delta > 3 days = deteriorating, < -3 days = improving.
 *
 *   Health logic:
 *     at_risk  = deteriorating trend AND on_time_rate < 0.85 (getting worse over time)
 *     watch    = consistently late but stable (on_time_rate < 0.70 OR avg_days_early_late > 15)
 *              = deteriorating but still paying well overall (on_time_rate >= 0.85)
 *     healthy  = on time and stable/improving
 *     unknown  = no transaction history
 *
 * @input PaymentTransaction[] — array of payment records with timing and on_time flag
 * @output PaymentBehaviourResult — derived amount-weighted metrics and trend/health
 * @usedBy ar-aging-agent (writes to customers table), cia-agent (reads from customers table)
 */

export interface PaymentTransaction {
  payment_date: string;
  days_to_pay: number;
  days_early_late: number; // negative = paid early, positive = paid late
  on_time: boolean;
  amount: number;
}

export interface PaymentBehaviourResult {
  on_time_rate: number | null;        // 0–1, amount-weighted; null if no history
  avg_days_early_late: number | null; // negative = pays early on average; null if no history
  avg_days_to_pay: number | null;     // null if no history
  trend: "improving" | "stable" | "deteriorating" | "insufficient_data";
  total_transactions: number;
  recent_on_time_rate: number | null; // last 3 transactions, amount-weighted; null if no history
  health: "healthy" | "watch" | "at_risk" | "unknown";
}

export function analysePaymentBehaviour(
  transactions: PaymentTransaction[]
): PaymentBehaviourResult {
  if (!transactions || transactions.length === 0) {
    return {
      on_time_rate: null,
      avg_days_early_late: null,
      avg_days_to_pay: null,
      trend: "insufficient_data",
      total_transactions: 0,
      recent_on_time_rate: null,
      health: "unknown",
    };
  }

  // Sort ascending by payment date so trend comparison is chronological
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()
  );

  const total = sorted.length;

  // Amount-weighted metrics — large invoices influence results more than small ones
  const totalAmount = sorted.reduce((sum, t) => sum + (t.amount ?? 1), 0);

  const weightedOnTime = sorted.reduce((sum, t) => sum + (t.on_time ? (t.amount ?? 1) : 0), 0);
  const on_time_rate = totalAmount > 0 ? weightedOnTime / totalAmount : 0;

  const avg_days_early_late =
    sorted.reduce((sum, t) => sum + (t.days_early_late ?? 0) * (t.amount ?? 1), 0) / totalAmount;

  const avg_days_to_pay =
    sorted.reduce((sum, t) => sum + (t.days_to_pay ?? 0) * (t.amount ?? 1), 0) / totalAmount;

  // Recent on-time rate: last 3 transactions, amount-weighted
  const recent = sorted.slice(-3);
  const recentAmount = recent.reduce((sum, t) => sum + (t.amount ?? 1), 0);
  const recent_on_time_rate =
    recent.reduce((sum, t) => sum + (t.on_time ? (t.amount ?? 1) : 0), 0) / recentAmount;

  // Trend: compare amount-weighted avg days_early_late in the first half vs second half
  // Threshold 3 days: delta > 3 = deteriorating, < -3 = improving
  let trend: PaymentBehaviourResult["trend"] = "insufficient_data";
  if (total >= 2) {
    const half = Math.ceil(total / 2);
    const earlyHalf = sorted.slice(0, half);
    const lateHalf = sorted.slice(half);
    const earlyAmount = earlyHalf.reduce((s, t) => s + (t.amount ?? 1), 0);
    const lateAmount = lateHalf.reduce((s, t) => s + (t.amount ?? 1), 0);
    const earlyHalfAvg = earlyHalf.reduce((s, t) => s + t.days_early_late * (t.amount ?? 1), 0) / earlyAmount;
    const lateHalfAvg = lateHalf.reduce((s, t) => s + t.days_early_late * (t.amount ?? 1), 0) / lateAmount;

    const delta = lateHalfAvg - earlyHalfAvg;
    if (delta > 3) trend = "deteriorating";
    else if (delta < -3) trend = "improving";
    else trend = "stable";
  }

  // Health signal:
  //   at_risk = deteriorating trend AND on_time_rate < 0.85 (actively getting worse)
  //   watch   = consistently late but stable, OR deteriorating but still paying well
  //   healthy = on time and stable/improving
  let health: PaymentBehaviourResult["health"] = "healthy";
  if (trend === "deteriorating" && on_time_rate < 0.85) {
    health = "at_risk";
  } else if (on_time_rate < 0.70 || avg_days_early_late > 15) {
    health = "watch";
  } else if (trend === "deteriorating") {
    health = "watch"; // deteriorating but still paying well overall
  }

  return {
    on_time_rate,
    avg_days_early_late: Math.round(avg_days_early_late * 10) / 10,
    avg_days_to_pay: Math.round(avg_days_to_pay * 10) / 10,
    trend,
    total_transactions: total,
    recent_on_time_rate,
    health,
  };
}
