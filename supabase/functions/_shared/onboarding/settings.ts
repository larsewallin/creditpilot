/**
 * Default onboarding policy. Overridden per company by company_settings
 * (onboarding.*) once the Settings page exists. Every number here is a
 * starting default, not an industry standard — see the build plan §8 and
 * the research report's limit section for where each comes from.
 */
import type { OnboardingSettings } from "./types.ts";

export const ONBOARDING_DEFAULTS: OnboardingSettings = {
  template: {
    min_trade_references: 3,
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
    compiled_statement_haircut_pct: 50,
    macro_haircut_pct: 20,
    band_multipliers: { A: 1.0, B: 0.75, C: 0.5, D: 0.35, E: 0 },
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
    // Keen first by default; a company using D&B, Creditsafe, Coface, Allianz Trade or Experian
    // moves it up in Settings › Credit score source. The first source with a score counts.
    score_order: ["keen", "dnb", "creditsafe", "coface", "allianz_trade", "experian", "other", "bureau_report"],
  },
};
