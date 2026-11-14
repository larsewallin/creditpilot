-- 20261114010000_customer_financials_age.sql
--
-- WHAT: (1) customers.financials_fye (financial year end of the accounts behind the
--       score), financials_source (sec_10k / statements / entered) and
--       credit_rating_checked_at (when the score source was last asked, whether or not the
--       score changed); (2) credit_events event type FINANCIALS_STALE.
-- WHY:  the Credit Rating agent re-scores active customers from Keen in production and
--       raises "Financials out of date" when the accounts are older than the score allows.
-- SCOPE: additive only; no existing row is changed. Demo customers keep their seeded scores.
-- HOW:  migrate.sh wraps this in a transaction; do not add BEGIN/COMMIT here.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS financials_fye date,
  ADD COLUMN IF NOT EXISTS financials_source text,
  ADD COLUMN IF NOT EXISTS credit_rating_checked_at timestamptz;

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
    'CREDIT_DECISION'::text, 'CUSTOMER_ACTIVATED'::text, 'FINANCIALS_STALE'::text
  ])));
