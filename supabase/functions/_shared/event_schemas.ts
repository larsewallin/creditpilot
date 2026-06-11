// V1 Event Taxonomy — Zod schemas for credit_events payloads.
//
// This file is the machine-readable contract that mirrors
// docs/EVENT_TAXONOMY.md. Every event type that agents emit must have
// a payload schema defined here.
//
// Use via the publishEvent() helper, which validates payloads before insert.
// Updating an event's payload shape requires updating both this file and
// the taxonomy document, then incrementing taxonomy_version if the change
// is incompatible.

import { z } from "https://esm.sh/zod@3";

// ============================================================================
// Shared enums
// ============================================================================

export const SeverityEnum = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeverityEnum>;

export const ScopeEnum = z.enum(["customer", "country", "industry", "currency", "portfolio"]);
export type Scope = z.infer<typeof ScopeEnum>;

export const SectorEnum = z.enum([
  "Aerospace & Defense",
  "Energy",
  "Industrial Manufacturing",
  "Materials",
  "Transportation",
  "Mining",
  "Other",
]);
export type Sector = z.infer<typeof SectorEnum>;


export const RatingAgencyEnum = z.enum(["sp", "moodys", "fitch"]);

export const SeverityScore = z.number().int().min(0).max(100);

// ============================================================================
// Customer-specific event payloads
// ============================================================================

export const SentimentEnum = z.enum(["negative", "positive", "neutral"]);

export const NewsEventPayload = z.object({
  severity_score: SeverityScore,
  sentiment: SentimentEnum,
  sentiment_score: z.number().min(-1).max(1),
  subcategory: z.string(),  // free-form (earnings_miss, layoffs, lawsuit, etc.)
  article_title: z.string(),
  article_url: z.string().url().nullable(),
  published_at: z.string().datetime(),
  source: z.string(),  // free-form publication name (e.g. "Reuters", "Seeking Alpha")
  provider: z.enum(["tavily", "google_news", "manual"]),  // fetch mechanism, not publication
  key_phrases: z.array(z.string()),
  summary: z.string(),
});

export const FilingSourceTypeEnum = z.enum(["10-K", "10-Q", "8-K", "other"]);

export const CovenantWaiverPayload = z.object({
  severity_score: SeverityScore,
  filing_source_type: FilingSourceTypeEnum.nullable(),
  waiver_date: z.string().date(),
  waived_covenant: z.string(),
  evidence_url: z.string().url(),
  summary: z.string(),
});

export const CeoDeparturePayload = z.object({
  severity_score: SeverityScore,
  filing_source_type: FilingSourceTypeEnum.nullable(),
  executive_name: z.string(),
  departure_type: z.enum(["resigned", "terminated", "retired", "other"]),
  departure_date: z.string().date(),
  evidence_url: z.string().url(),
  summary: z.string(),
});

export const RevenueMissPayload = z.object({
  severity_score: SeverityScore,
  filing_source_type: FilingSourceTypeEnum.nullable(),
  reported_revenue_usd: z.number(),
  expected_revenue_usd: z.number(),
  miss_percent: z.number(),
  period: z.string(),
  summary: z.string(),
});

export const GoingConcernPayload = z.object({
  severity_score: SeverityScore,
  filing_source_type: FilingSourceTypeEnum.nullable(),
  evidence_url: z.string().url(),
  summary: z.string(),
});

export const SecOtherPayload = z.object({
  severity_score: SeverityScore,
  filing_source_type: FilingSourceTypeEnum,
  concern_category: z.string(),
  evidence_url: z.string().url(),
  summary: z.string(),
});

export const OverdueArPayload = z.object({
  severity_score: SeverityScore,
  total_overdue_usd: z.number(),
  bucket_1_30_usd: z.number(),
  bucket_31_60_usd: z.number(),
  bucket_61_90_usd: z.number(),
  bucket_over_90_usd: z.number(),
  invoice_count: z.number().int(),
  oldest_invoice_days_overdue: z.number().int(),
  disputed_invoice_count: z.number().int().optional(),
  pre_petition_amount_usd: z.number().optional(),
});

export const UtilizationThresholdBreachPayload = z.object({
  severity_score: SeverityScore,
  current_exposure_usd: z.number(),
  credit_limit_usd: z.number(),
  utilization_percent: z.number(),
  threshold_crossed: z.number(),
  overage_usd: z.number().nullable(),
});

export const PaymentDeteriorationPayload = z.object({
  severity_score: SeverityScore,
  current_avg_days_to_pay: z.number(),
  prior_avg_days_to_pay: z.number(),
  trend_direction: z.enum(["worsening", "sharply_worsening"]),
  observation_window_days: z.number().int(),
  summary: z.string(),
});

export const PaymentImprovementPayload = z.object({
  severity_score: SeverityScore,
  current_avg_days_to_pay: z.number(),
  prior_avg_days_to_pay: z.number(),
  trend_direction: z.enum(["improving", "sharply_improving"]),
  observation_window_days: z.number().int(),
  summary: z.string(),
});

export const PaymentVolatilityPayload = z.object({
  severity_score: SeverityScore,
  standard_deviation_days: z.number(),
  observation_window_days: z.number().int(),
  summary: z.string(),
});

// ============================================================================
// Environment event payloads
// ============================================================================

export const CountryRatingChangePayload = z.object({
  severity_score: SeverityScore,
  country_code: z.string().length(2),
  country_name: z.string(),
  agency: RatingAgencyEnum,
  old_rating: z.string(),
  new_rating: z.string(),
  outlook: z.enum(["positive", "stable", "negative", "watch"]),
  effective_date: z.string().date(),
});

export const CountryPoliticalRiskPayload = z.object({
  severity_score: SeverityScore,
  country_code: z.string().length(2),
  risk_type: z.enum(["election", "unrest", "sanctions", "capital_controls", "other"]),
  summary: z.string(),
  evidence_url: z.string().url(),
});

export const CountryEconomicShockPayload = z.object({
  severity_score: SeverityScore,
  country_code: z.string().length(2),
  shock_type: z.enum(["currency_crisis", "recession", "inflation", "banking_crisis", "other"]),
  summary: z.string(),
  evidence_url: z.string().url(),
});

export const InterestRateChangePayload = z.object({
  severity_score: SeverityScore,
  country_code: z.string().length(2),
  central_bank: z.string(),
  old_rate_percent: z.number(),
  new_rate_percent: z.number(),
  effective_date: z.string().date(),
});

export const IndustryDownturnPayload = z.object({
  severity_score: SeverityScore,
  sector: SectorEnum,
  indicator: z.string(),
  change_percent: z.number(),
  period_days: z.number().int(),
  summary: z.string(),
});

export const IndustryDisruptionPayload = z.object({
  severity_score: SeverityScore,
  sector: SectorEnum,
  disruption_type: z.enum(["supply_chain", "regulatory", "technology", "demand_shock", "other"]),
  summary: z.string(),
  evidence_url: z.string().url(),
});

export const RegulatoryChangePayload = z.object({
  severity_score: SeverityScore,
  sector: SectorEnum.optional(),
  country_code: z.string().length(2).optional(),
  regulation_name: z.string(),
  effective_date: z.string().date(),
  summary: z.string(),
});

export const TariffChangePayload = z.object({
  severity_score: SeverityScore,
  tariff_change_percent: z.number(),
  affected_countries: z.array(z.string().length(2)),
  affected_sectors: z.array(z.string()),
  effective_date: z.string().date(),
  summary: z.string(),
});

// ============================================================================
// Synthesized event payloads
// ============================================================================

export const RiskChangePayload = z.object({
  severity_score: SeverityScore,
  change_type: z.enum(["escalation", "downgrade", "upgrade", "cleared"]),
  risk_components: z.array(z.object({
    type: z.string(),
    severity_score: SeverityScore,
    source_event_id: z.string().uuid(),
  })),
  prior_risk_score: z.number(),
  new_risk_score: z.number(),
  reasoning: z.string(),
});

export const ConcentrationDimensionEnum = z.enum(["customer", "sector", "country", "currency"]);

export const ConcentrationThresholdBreachPayload = z.object({
  severity_score: SeverityScore,
  dimension: ConcentrationDimensionEnum,
  dimension_value: z.string(),
  current_exposure_usd: z.number(),
  total_book_usd: z.number(),
  concentration_percent: z.number(),
  threshold_crossed_percent: z.number(),
});

export const PortfolioInsightPayload = z.object({
  insight_type: z.enum(["concentration_trend", "sector_shift", "aging_trend", "other"]),
  summary: z.string(),
  affected_dimension: z.string(),
  direction: z.enum(["increasing", "decreasing"]),
  magnitude: z.number(),
});

export const ConcentrationWarningPayload = z.object({
  severity_score: SeverityScore,
  dimension: ConcentrationDimensionEnum,
  projected_breach_date: z.string().date(),
  current_concentration_percent: z.number(),
  projected_concentration_percent: z.number(),
  recommendation: z.string(),
});

export const ExpansionOpportunityPayload = z.object({
  dimension: z.string(),
  dimension_value: z.string(),
  rationale: z.string(),
  proposed_expansion_usd: z.number().optional(),
});

export const EmergingRiskSignalPayload = z.object({
  theme: z.string(),
  time_horizon_months: z.number().int(),
  confidence: z.enum(["low", "medium", "high"]),
  affected_sectors: z.array(z.string()),
  affected_countries: z.array(z.string().length(2)),
  summary: z.string(),
});

export const MacroTrendWarningPayload = EmergingRiskSignalPayload;

export const FxExposureFlagPayload = z.object({
  severity_score: SeverityScore,
  currency_code: z.string().length(3),
  total_exposure_usd: z.number(),
  customers_affected: z.number().int(),
  reason: z.string(),
});

export const FxHedgingNeededPayload = FxExposureFlagPayload.extend({
  recommended_hedge_amount_usd: z.number(),
});

export const CurrencyVolatilityPayload = z.object({
  severity_score: SeverityScore,
  currency_code: z.string().length(3),
  volatility_percent: z.number(),
  period_days: z.number().int(),
  summary: z.string(),
});

// ============================================================================
// Event type registry
// ============================================================================

export const EVENT_TYPES = [
  "NEWS_EVENT",
  "COVENANT_WAIVER",
  "CEO_DEPARTURE",
  "REVENUE_MISS",
  "GOING_CONCERN",
  "SEC_OTHER",
  "OVERDUE_AR",
  "UTILIZATION_THRESHOLD_BREACH",
  "PAYMENT_DETERIORATION",
  "PAYMENT_IMPROVEMENT",
  "PAYMENT_VOLATILITY",
  "COUNTRY_RATING_CHANGE",
  "COUNTRY_POLITICAL_RISK",
  "COUNTRY_ECONOMIC_SHOCK",
  "INTEREST_RATE_CHANGE",
  "INDUSTRY_DOWNTURN",
  "INDUSTRY_DISRUPTION",
  "REGULATORY_CHANGE",
  "TARIFF_CHANGE",
  "RISK_CHANGE",
  "CONCENTRATION_THRESHOLD_BREACH",
  "PORTFOLIO_INSIGHT",
  "CONCENTRATION_WARNING",
  "EXPANSION_OPPORTUNITY",
  "EMERGING_RISK_SIGNAL",
  "MACRO_TREND_WARNING",
  "FX_EXPOSURE_FLAG",
  "FX_HEDGING_NEEDED",
  "CURRENCY_VOLATILITY",
] as const;

export type EventType = typeof EVENT_TYPES[number];

export const EventTypeEnum = z.enum(EVENT_TYPES);

const payloadSchemas: Record<EventType, z.ZodTypeAny> = {
  NEWS_EVENT: NewsEventPayload,
  COVENANT_WAIVER: CovenantWaiverPayload,
  CEO_DEPARTURE: CeoDeparturePayload,
  REVENUE_MISS: RevenueMissPayload,
  GOING_CONCERN: GoingConcernPayload,
  SEC_OTHER: SecOtherPayload,
  OVERDUE_AR: OverdueArPayload,
  UTILIZATION_THRESHOLD_BREACH: UtilizationThresholdBreachPayload,
  PAYMENT_DETERIORATION: PaymentDeteriorationPayload,
  PAYMENT_IMPROVEMENT: PaymentImprovementPayload,
  PAYMENT_VOLATILITY: PaymentVolatilityPayload,
  COUNTRY_RATING_CHANGE: CountryRatingChangePayload,
  COUNTRY_POLITICAL_RISK: CountryPoliticalRiskPayload,
  COUNTRY_ECONOMIC_SHOCK: CountryEconomicShockPayload,
  INTEREST_RATE_CHANGE: InterestRateChangePayload,
  INDUSTRY_DOWNTURN: IndustryDownturnPayload,
  INDUSTRY_DISRUPTION: IndustryDisruptionPayload,
  REGULATORY_CHANGE: RegulatoryChangePayload,
  TARIFF_CHANGE: TariffChangePayload,
  RISK_CHANGE: RiskChangePayload,
  CONCENTRATION_THRESHOLD_BREACH: ConcentrationThresholdBreachPayload,
  PORTFOLIO_INSIGHT: PortfolioInsightPayload,
  CONCENTRATION_WARNING: ConcentrationWarningPayload,
  EXPANSION_OPPORTUNITY: ExpansionOpportunityPayload,
  EMERGING_RISK_SIGNAL: EmergingRiskSignalPayload,
  MACRO_TREND_WARNING: MacroTrendWarningPayload,
  FX_EXPOSURE_FLAG: FxExposureFlagPayload,
  FX_HEDGING_NEEDED: FxHedgingNeededPayload,
  CURRENCY_VOLATILITY: CurrencyVolatilityPayload,
};

export function getPayloadSchema(eventType: string): z.ZodTypeAny {
  const schema = payloadSchemas[eventType as EventType];
  if (!schema) {
    throw new Error(`Unknown event_type: ${eventType}. Update event_schemas.ts and the taxonomy doc.`);
  }
  return schema;
}

// ============================================================================
// Severity score <-> qualitative severity mapping
// ============================================================================

export function severityToScore(severity: Severity): number {
  switch (severity) {
    case "critical": return 92;
    case "high": return 75;
    case "medium": return 52;
    case "low": return 27;
    case "info": return 7;
  }
}

export function scoreToSeverity(score: number): Severity {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  if (score >= 15) return "low";
  return "info";
}
