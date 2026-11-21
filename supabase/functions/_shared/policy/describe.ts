/**
 * The company's Trade Credit Policy in plain sentences, for the CIA: when an answer rests on a
 * rule (why something was flagged, whether a payment counts as late, why a cut is proposed),
 * the CIA states the company's own rule with its value. Pure and deterministic: every number
 * comes from the policy, none from the model.
 */
import type { CreditPolicy, PolicyGroup } from "./defaults.ts";
import { flatten } from "./flatten.ts";

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

export function describePolicy(p: CreditPolicy, groups: Record<string, PolicyGroup> = {}): string {
  const lines = [
    `Score scale (0–100): 85+ Very strong, 70–84 Strong, 55–69 Adequate, 40–54 Watch, 25–39 Elevated risk, under 25 High risk.`,
    `Payments: a payment within ${p.payments.grace_days} days of its due date counts as on time. Lateness is measured against each customer's own payment terms. Watch: paid on time less than ${pct(p.payments.watch_on_time_below)} of the time, or average lateness above ${p.payments.watch_avg_late_pct_of_terms}% of the terms. At risk: getting slower by more than ${p.payments.trend_pct_of_terms}% of the terms and paid on time less than ${pct(p.payments.at_risk_on_time_below)}.`,
    `Payment trend: the last ${p.payment_trend.window_days} days against the ${p.payment_trend.window_days} before; slower by ${p.payment_trend.swing_pct_of_terms}% of the terms is medium, ${p.payment_trend.swing_high_pct_of_terms}% high, ${p.payment_trend.swing_critical_pct_of_terms}% critical.`,
    `Overdue: no alert below ${usd(p.overdue.materiality_usd)} or ${p.overdue.materiality_pct_of_limit}% of the limit, whichever is higher; severity by the oldest overdue invoice: 1–30 days low, 31–60 medium, 61–90 high, over 90 critical when it is at least ${p.overdue.critical_min_pct_of_limit}% of the limit, otherwise high.`,
    `Limit use: an alert above ${p.utilization.high_pct}% of the limit (critical above ${p.utilization.critical_pct}%) when the customer is over its limit or has a weak signal: a score below ${p.utilization.weak_score_below}, or payments at risk or getting slower.`,
    `Limit reviews: a cut is considered at limit use above ${p.limit_review.high_utilization_pct}% with overdue or a weak score, at High risk (score below ${p.limit_review.distress_score_below}) or Elevated risk (up to ${p.limit_review.concern_score_up_to}); no single cut is larger than ${p.limit_review.max_reduction_pct}% or ${usd(p.limit_review.max_reduction_usd)}. Every proposal waits for a person.`,
    `Score changes: a drop of ${p.score_change.medium_from} points or more raises an alert (${p.score_change.high_from} high, ${p.score_change.critical_from} critical); changes under ${p.score_change.ignore_below} are ignored.`,
  ];
  const named = Object.values(groups).filter((g) => g && Object.keys(g.overrides ?? {}).length);
  if (named.length) {
    lines.push("Customer groups (a customer in a group follows its group's rules; everything else as above):");
    for (const g of named) {
      const changes = Object.entries(g.overrides).flatMap(([s, v]) => flatten(v).map(([f, n]) => `${s}.${f} = ${n}`));
      lines.push(`- ${g.name}: ${changes.join(", ")}${g.note ? ` (${g.note})` : ""}`);
    }
  }
  return lines.join("\n");
}
