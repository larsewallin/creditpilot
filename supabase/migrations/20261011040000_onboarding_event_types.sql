-- 20261011040000_onboarding_event_types.sql
--
-- Phase 0 of New Customer Onboarding: allow the eight onboarding event types in
-- credit_events (34 -> 42 values). Without this every publishEvent for them
-- would fail with 23514, same failure mode as 20260930090000.
-- Existing values are unchanged. See docs/EVENT_TAXONOMY.md "Onboarding events".

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
    'DAILY_BRIEFING'::text, 'COMPOSITE_RISK_CRITICAL'::text, 'COMPOSITE_RISK_ELEVATED'::text,
    'CREDIT_RATING_DOWNGRADE'::text, 'CREDIT_RATING_UPGRADE'::text,
    'APPLICATION_SUBMITTED'::text, 'APPLICATION_INCOMPLETE'::text, 'SCREENING_PASS'::text,
    'SCREENING_REVIEW'::text, 'SANCTIONS_HIT'::text, 'CREDIT_ANALYSIS_COMPLETE'::text,
    'CREDIT_DECISION'::text, 'CUSTOMER_ACTIVATED'::text
  ])));
