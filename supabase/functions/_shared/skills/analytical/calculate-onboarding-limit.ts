/**
 * @skill calculate-onboarding-limit
 * @type analytical
 * @description Proposes a first credit limit for a new customer (prospect).
 *   Pure and deterministic: every number comes from the inputs and the
 *   company's onboarding.limits settings (defaults in onboarding/settings.ts).
 *
 *   needs        = monthly purchases × (terms ÷ 30) × (1 + buffer)       (falls back to the request)
 *   caps         = lowest of: working capital × wc%, net worth × nw%     (both × (1 − haircut) for compiled statements)
 *                  and any bureau / File maximum credit recommendation
 *   risk-adjusted = cap × score-band multiplier × (1 − macro haircut, once, if a Country or FX signal applies)
 *   supportable  = risk-adjusted, rounded down
 *   recommended  = lowest of needs and risk-adjusted, rounded down
 *   decision     = request ≤ recommended → approve as requested; otherwise counteroffer at recommended;
 *                  no score, no cap basis or recommended 0 → decline_review (a person decides)
 *   Never proposes more than was requested. Every proposal needs a person (human_required).
 *
 * @input OnboardingLimitInput
 * @output OnboardingLimitResult
 * @usedBy onboarding pipeline (_shared/onboarding/pipeline.ts), cia-agent onboarding mode (planned)
 */
import type { FinancialStatement, OnboardingSettings } from "../../onboarding/types.ts";

export type Band = "A" | "B" | "C" | "D" | "E";
export type BindingMethod = "needs_based" | "working_capital" | "net_worth" | "bureau_recommendation";

export interface OnboardingLimitInput {
  requested_usd: number;
  monthly_purchases_usd?: number;
  terms_days?: number;
  /** Latest statement in USD, or undefined when there are no usable financials. */
  statement?: FinancialStatement;
  /** Maximum credit recommendations from a bureau report or File, in USD. */
  max_credit_recommendations_usd?: number[];
  band: Band | null;
  macro: { country: boolean; fx: boolean };
  limits: OnboardingSettings["limits"];
}

export interface OnboardingLimitResult {
  decision: "approve_as_requested" | "counteroffer" | "decline_review";
  human_required: true;
  requested_usd: number;
  needs_usd: number;
  caps: { working_capital?: number; net_worth?: number; bureau_recommendation?: number };
  cap_usd?: number;
  risk_adjusted_cap_usd?: number;
  recommended_usd?: number;
  supportable_usd?: number;
  proposed_usd?: number;
  binding_method?: BindingMethod;
  higher_limit_note: boolean;
  macro_haircut_applied: boolean;
  reason_codes: string[];
}

export function scoreToBand(score: number | null | undefined): Band | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "E";
}

const BINDING_CODE: Record<Exclude<BindingMethod, "needs_based">, string> = {
  working_capital: "LIMIT_CAPPED_WORKING_CAPITAL",
  net_worth: "LIMIT_CAPPED_NET_WORTH",
  bureau_recommendation: "LIMIT_CAPPED_BUREAU_RECOMMENDATION",
};

export function calculateOnboardingLimit(input: OnboardingLimitInput): OnboardingLimitResult {
  const L = input.limits;
  const requested = Math.max(0, input.requested_usd);
  const roundDown = (x: number) => Math.floor(x / L.rounding_usd) * L.rounding_usd;
  const reason_codes: string[] = [];

  const needs = input.monthly_purchases_usd && input.terms_days
    ? input.monthly_purchases_usd * (input.terms_days / 30) * (1 + L.needs_buffer_pct / 100)
    : requested;

  const caps: OnboardingLimitResult["caps"] = {};
  const s = input.statement;
  if (s) {
    const quality = s.statement_quality === "compiled" ? 1 - L.compiled_statement_haircut_pct / 100 : 1;
    if (s.statement_quality === "compiled") reason_codes.push("STATEMENT_QUALITY_COMPILED");
    if (s.current_assets !== undefined && s.current_liabilities !== undefined) {
      caps.working_capital = Math.max(0, s.current_assets - s.current_liabilities) * (L.working_capital_pct / 100) * quality;
    }
    const netWorth = s.equity ?? (s.total_assets !== undefined && s.total_liabilities !== undefined ? s.total_assets - s.total_liabilities : undefined);
    if (netWorth !== undefined) caps.net_worth = Math.max(0, netWorth) * (L.net_worth_pct / 100) * quality;
  }
  const recs = (input.max_credit_recommendations_usd ?? []).filter((x) => Number.isFinite(x) && x >= 0);
  if (recs.length) caps.bureau_recommendation = Math.min(...recs);

  const base: OnboardingLimitResult = {
    decision: "decline_review", human_required: true, requested_usd: requested, needs_usd: needs,
    caps, higher_limit_note: false, macro_haircut_applied: false, reason_codes,
  };

  if (!input.band) { reason_codes.push("NO_SCORE_AVAILABLE"); return base; }

  const capEntries = Object.entries(caps) as [Exclude<BindingMethod, "needs_based">, number][];
  if (!capEntries.length) { reason_codes.push("NO_CAP_BASIS"); return base; }
  const [capMethod, cap] = capEntries.reduce((a, b) => (b[1] < a[1] ? b : a));

  const macroHit = input.macro.country || input.macro.fx;
  if (input.macro.country) reason_codes.push("MACRO_COUNTRY_RISK");
  if (input.macro.fx) reason_codes.push("MACRO_FX_RISK");
  const riskAdjusted = cap * L.band_multipliers[input.band] * (macroHit ? 1 - L.macro_haircut_pct / 100 : 1);

  const binding: BindingMethod = needs <= riskAdjusted ? "needs_based" : capMethod;
  if (binding !== "needs_based") reason_codes.push(BINDING_CODE[binding]);

  const supportable = roundDown(riskAdjusted);
  const recommended = roundDown(Math.min(needs, riskAdjusted));
  const result: OnboardingLimitResult = {
    ...base, cap_usd: cap, risk_adjusted_cap_usd: riskAdjusted,
    recommended_usd: recommended, supportable_usd: supportable, binding_method: binding,
    macro_haircut_applied: macroHit,
  };

  if (recommended <= 0) { reason_codes.push(input.band === "E" ? "SCORE_BAND_E" : "NO_SUPPORTABLE_LIMIT"); return result; }

  if (requested <= recommended) { result.decision = "approve_as_requested"; result.proposed_usd = requested; }
  else { result.decision = "counteroffer"; result.proposed_usd = recommended; }

  if (supportable >= L.higher_limit_note_ratio * requested) {
    result.higher_limit_note = true;
    reason_codes.push("HIGHER_LIMIT_SUPPORTABLE");
  }
  return result;
}
