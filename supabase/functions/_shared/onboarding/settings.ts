/**
 * Default onboarding policy. Overridden per company by company_settings
 * (onboarding.*) once the Settings page exists. Every number here is a
 * starting default, not an industry standard — see the build plan §8 and
 * the research report's limit section for where each comes from.
 */
import type { OnboardingSettings } from "./types.ts";

export const ONBOARDING_DEFAULTS: OnboardingSettings = {
  template: {
    // Trade references asked for, by the applicant's size (latest revenue) and score
    // (founder, 2026-11-20: a large company needs none). Unknown revenue counts as small.
    trade_references: {
      large_revenue_usd: 500_000_000,
      large: 0,
      mid_revenue_usd: 25_000_000,
      mid: 2,
      small: 3,
      fewer_if_strong_or_better: 1,
    },
    statements_required_above_usd: 250_000,
    guarantee_required_if_entity_younger_than_months: 24,
  },
  screening: {
    name_match_review_threshold: 0.85,
    name_match_hit_threshold: 0.99,   // Jaro-Winkler scale: near-exact after normalization
    fraud_flags_for_review: 2,
    young_entity_months: 24,
    young_entity_large_request_usd: 100_000,
    new_domain_months: 12,
  },
  limits: {
    needs_buffer_pct: 15,
    working_capital_pct: 10,
    net_worth_pct: 10,
    // Balance-sheet caps are reduced by how much the statements can be relied on.
    statement_haircuts_pct: { audited: 0, reviewed: 15, compiled: 30, tax_return: 30, management: 50 },
    macro_haircut_pct: 20,
    // Share of the cap by the score's label (founder, 2026-11-20): Adequate and better are good
    // credits; other warnings (country, FX, screening) have their own rules.
    score_multipliers: { very_strong: 1, strong: 1, adequate: 1, watch: 0.8, elevated: 0.5, high_risk: 0 },
    // Elevated still gets the full cap when the request is small for the company: at most this % of its revenue.
    elevated_full_if_request_pct_of_revenue_up_to: 0.1,
    higher_limit_note_ratio: 1.2,
    rounding_usd: 5_000,
  },
  // Months a financial year end may be old before newer accounts are asked for. Lower score, stricter:
  // annual accounts usually arrive 90-120 days after year end (12 + 3-4 months), Keen itself holds a
  // score at 69 once the year end is over 15 months old, and riskier accounts are commonly reviewed
  // every six months or quarterly (half-year or quarterly accounts).
  financials: {
    max_age_months_70_plus: 15,
    max_age_months_55_to_69: 12,
    max_age_months_40_to_54: 9,
    max_age_months_below_40: 6,
    max_age_months_no_score: 12,
    due_soon_months: 2,
  },
  sources: {
    // The first source with a score counts; order in Settings › Credit score source. Keen is
    // paused in onboarding (KEEN_IN_ONBOARDING in score_providers.ts) and skipped while it is.
    score_order: ["keen", "dnb", "creditsafe", "coface", "allianz_trade", "experian", "other", "bureau_report"],
  },
};
