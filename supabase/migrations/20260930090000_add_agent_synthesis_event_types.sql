-- F0 follow-up: cia-agent's live briefing/decisioning path (enabled 2026-09-30)
-- writes synthesis events (DAILY_BRIEFING, COMPOSITE_RISK_CRITICAL,
-- COMPOSITE_RISK_ELEVATED) that credit_events_event_type_check did not allow,
-- so every one of these inserts has been silently failing (23514).
-- These are agent-output events (the agent's own synthesis), distinct from
-- the existing 29 input-signal types, so we extend the taxonomy rather than
-- overload an existing value.

ALTER TABLE credit_events
  DROP CONSTRAINT credit_events_event_type_check;

ALTER TABLE credit_events
  ADD CONSTRAINT credit_events_event_type_check CHECK ((event_type = ANY (ARRAY[
    'NEWS_EVENT'::text, 'COVENANT_WAIVER'::text, 'CEO_DEPARTURE'::text, 'REVENUE_MISS'::text,
    'GOING_CONCERN'::text, 'SEC_OTHER'::text, 'OVERDUE_AR'::text, 'UTILIZATION_THRESHOLD_BREACH'::text,
    'PAYMENT_DETERIORATION'::text, 'PAYMENT_IMPROVEMENT'::text, 'PAYMENT_VOLATILITY'::text,
    'COUNTRY_RATING_CHANGE'::text, 'COUNTRY_POLITICAL_RISK'::text, 'COUNTRY_ECONOMIC_SHOCK'::text,
    'INTEREST_RATE_CHANGE'::text, 'INDUSTRY_DOWNTURN'::text, 'INDUSTRY_DISRUPTION'::text,
    'REGULATORY_CHANGE'::text, 'TARIFF_CHANGE'::text, 'RISK_CHANGE'::text,
    'CONCENTRATION_THRESHOLD_BREACH'::text, 'PORTFOLIO_INSIGHT'::text, 'CONCENTRATION_WARNING'::text,
    'EXPANSION_OPPORTUNITY'::text, 'EMERGING_RISK_SIGNAL'::text, 'MACRO_TREND_WARNING'::text,
    'FX_EXPOSURE_FLAG'::text, 'FX_HEDGING_NEEDED'::text, 'CURRENCY_VOLATILITY'::text,
    'DAILY_BRIEFING'::text, 'COMPOSITE_RISK_CRITICAL'::text, 'COMPOSITE_RISK_ELEVATED'::text
  ])));
