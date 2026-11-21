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
  /** How payment history is judged (analyse-payment-behaviour). */
  payments: {
    /** Days after the due date a payment still counts as on time. */
    grace_days: 0,
    /** Change in average days late, first half vs second half of history, that counts as a trend. */
    trend_days: 3,
    /** Deteriorating and an on-time rate below this: at risk. */
    at_risk_on_time_below: 0.85,
    /** On-time rate below this: watch. */
    watch_on_time_below: 0.70,
    /** Average days late above this: watch. */
    watch_avg_late_days: 15,
  },
  /** 90-day against the previous 90 days (analyse-payment-trend). */
  payment_trend: {
    window_days: 90,
    swing_days: 5,
    swing_high_days: 10,
    swing_critical_days: 20,
    volatility_days: 10,
    volatility_critical_days: 20,
  },
  /** Overdue invoices (ar-aging-agent). 0 = no minimum. */
  overdue: {
    /** Overdue below this amount raises no alert. */
    materiality_usd: 0,
    /** Overdue below this % of the customer's limit raises no alert. */
    materiality_pct_of_limit: 0,
  },
  /** Limit use (ar-aging-agent). */
  utilization: {
    high_pct: 80,
    critical_pct: 95,
    /** Below the limit, high use is an alert only with a weak signal: a score below this, or payments at risk / deteriorating. */
    weak_score_below: 50,
  },
  /** Limit reduction proposals for existing customers (calculate-credit-limit-proposal). */
  limit_review: {
    distress_score_below: 20,
    concern_score_up_to: 40,
    high_overdue_pct_of_limit: 10,
    high_utilization_pct: 70,
    critical_utilization_pct: 85,
    strategic_latitude_pct: 10,
    max_reduction_usd: 1_000_000,
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
