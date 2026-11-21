/**
 * Trade Credit Policy: the company-wide rules every monitoring agent reads.
 *
 * One section per company_settings key "policy.<section>". A stored row holds only the
 * company's overrides; these defaults fill the rest (same pattern as onboarding.*).
 * Onboarding rules stay under onboarding.* and are part of the same policy.
 *
 * Every value here is a starting default, not an industry standard. The company sets
 * its own in Settings › Credit policy. Spec: "Trade Credit Policy — Stage 1 spec".
 */
import { FX_POLICY_DEFAULTS } from "../skills/analytical/analyse-fx-exposure.ts";

export const POLICY_DEFAULTS = {
  /**
   * How payment history is judged (analyse-payment-behaviour). Lateness is measured against
   * each customer's own payment terms (customers.payment_terms_days), so one policy fits
   * net 15 and net 90 alike (founder, 2026-11-20).
   */
  payments: {
    /** Days after the due date a payment still counts as on time. */
    grace_days: 5,
    /** Average lateness rising by more than this % of the customer's terms (first half vs second half of history): deteriorating. */
    trend_pct_of_terms: 10,
    /** Deteriorating and an on-time rate below this: at risk. */
    at_risk_on_time_below: 0.85,
    /** On-time rate below this: watch. */
    watch_on_time_below: 0.70,
    /** Average lateness above this % of the customer's terms: watch. */
    watch_avg_late_pct_of_terms: 25,
  },
  /** The last 90 days against the 90 before (analyse-payment-trend). Swings are % of the customer's terms. */
  payment_trend: {
    window_days: 90,
    swing_pct_of_terms: 15,
    swing_high_pct_of_terms: 30,
    swing_critical_pct_of_terms: 60,
    volatility_days: 10,
    volatility_critical_days: 20,
  },
  /** Overdue invoices (ar-aging-agent). */
  overdue: {
    /** Overdue below this amount raises no alert. */
    materiality_usd: 1_000,
    /** Overdue below this % of the customer's limit raises no alert. */
    materiality_pct_of_limit: 2,
    /** Over 90 days is critical only when it is at least this % of the limit; otherwise high. */
    critical_min_pct_of_limit: 10,
  },
  /** Limit use (ar-aging-agent). */
  utilization: {
    high_pct: 80,
    critical_pct: 95,
    /** Below the limit, high use is an alert only with a weak signal: a score below this (Watch or lower), or payments at risk / deteriorating. */
    weak_score_below: 55,
  },
  /** Limit reduction proposals for existing customers (calculate-credit-limit-proposal). */
  limit_review: {
    // On CreditPilot's one scale (score_scale.ts): High risk below 25, Elevated risk 25–39.
    distress_score_below: 25,
    concern_score_up_to: 39,
    high_overdue_pct_of_limit: 10,
    high_utilization_pct: 70,
    critical_utilization_pct: 85,
    strategic_latitude_pct: 10,
    max_reduction_usd: 1_000_000,
    /** No single proposal cuts a limit by more than this %. */
    max_reduction_pct: 50,
  },
  /** Composite risk across agents (assess-composite-risk). */
  composite: {
    base_threshold_pct: 75,
    floor_pct: 40,
    negative_news_pts: 10,
    going_concern_pts: 15,
    covenant_waiver_pts: 12,
    ceo_departure_pts: 5,
    score_drop_pts: 10,
    macro_two_dimensions_pts: 5,
    macro_three_dimensions_pts: 10,
    distress_score_pts: 15,
    concern_score_pts: 5,
  },
  /** A change in a customer's own score (detect-rating-change). */
  score_change: {
    ignore_below: 5,
    medium_from: 10,
    high_from: 20,
    critical_from: 30,
  },
  /** Currency exposure (fx-risk-agent). */
  fx: { ...FX_POLICY_DEFAULTS },
};

export type CreditPolicy = typeof POLICY_DEFAULTS;
export type PolicySection = keyof CreditPolicy;
export const POLICY_SECTIONS = Object.keys(POLICY_DEFAULTS) as PolicySection[];

/** Partial policy: only the rules a group changes. */
export type PolicyOverrides = { [S in PolicySection]?: Partial<CreditPolicy[S]> };

/**
 * A customer group overrides only the rules it needs (customers.policy_group = the group's key).
 * Stored whole as company_settings "policy.groups"; these starter groups are the default and
 * every one is editable (founder, 2026-11-20). Values are judgment starting points.
 */
export interface PolicyGroup { name: string; note: string; overrides: PolicyOverrides }

export const POLICY_GROUP_DEFAULTS: Record<string, PolicyGroup> = {
  strategic: {
    name: "Strategic",
    note: "Key accounts: more room on limit use before a cut, and smaller cuts.",
    overrides: { limit_review: { high_utilization_pct: 80, critical_utilization_pct: 95, max_reduction_pct: 20 } },
  },
  high_risk: {
    name: "High risk",
    note: "Customers the credit team watches closely: no grace days and an earlier limit-use alert.",
    overrides: { payments: { grace_days: 0 }, utilization: { high_pct: 70 } },
  },
  export: {
    name: "Export",
    note: "Cross-border customers: payments take longer to arrive.",
    overrides: { payments: { grace_days: 10 } },
  },
};
