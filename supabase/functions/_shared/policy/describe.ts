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
    `When to act on limit use (the one rule for limit cuts): a cut is proposed when limit use reaches ${p.composite.base_threshold_pct}%, lowered for each open warning sign: serious negative news ${p.composite.negative_news_pts} points, going-concern doubt ${p.composite.going_concern_pts}, covenant waiver ${p.composite.covenant_waiver_pts}, CEO departure ${p.composite.ceo_departure_pts}, a score drop ${p.composite.score_drop_pts}, High risk score ${p.composite.distress_score_pts}, Elevated risk score ${p.composite.concern_score_pts}, country/industry/currency risk ${p.composite.macro_two_dimensions_pts} (2 at once) or ${p.composite.macro_three_dimensions_pts} (3), paid on time less than half the time ${p.composite.on_time_below_half_pts}, less than ${pct(p.payments.watch_on_time_below)} ${p.composite.on_time_watch_pts}, less than ${pct(p.payments.at_risk_on_time_below)} ${p.composite.on_time_at_risk_pts}; never below ${p.composite.floor_pct}%. The limit-use alert at ${p.utilization.high_pct}% is an earlier warning, not this rule. Each proposal states the level that applied to that customer.`,
    `Limit reviews: cuts are larger with more than ${p.limit_review.high_overdue_pct_of_limit}% of the limit over 90 days overdue, at critical limit use (${p.utilization.critical_pct}% or more), at High risk (score below ${p.limit_review.distress_score_below}) or Elevated risk (up to ${p.limit_review.concern_score_up_to}); no single cut is larger than ${p.limit_review.max_reduction_pct}% or ${usd(p.limit_review.max_reduction_usd)}. A High risk customer always gets a proposal: the limit comes down to what it owes${p.limit_review.high_risk_headroom_pct ? ` plus ${p.limit_review.high_risk_headroom_pct}%` : ""}, whatever its limit use. After a person rejects a cut, no new one is proposed for ${p.limit_review.rejection_quiet_days} days unless the new cut is at least ${p.limit_review.reopen_extra_cut_pct} points deeper. Every proposal waits for a person.`,
    `Approval authority: a credit analyst may approve a limit up to ${p.approvals.credit_analyst_usd ? usd(p.approvals.credit_analyst_usd) : "any amount"}, a credit manager up to ${p.approvals.credit_manager_usd ? usd(p.approvals.credit_manager_usd) : "any amount"}, an admin ${p.approvals.admin_usd ? `up to ${usd(p.approvals.admin_usd)}` : "any amount"}; above that the person recommends and someone with enough authority approves. Cutting a limit needs no authority.`,
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
