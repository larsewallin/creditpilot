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
  sources: {
    score_order: ["file", "bureau_report"],
  },
};
