-- Lock credit_events.event_type to the V1 taxonomy values.
--
-- All existing rows conform (migrated in the prior migration). This
-- constraint rejects any future insert with an event_type outside the
-- V1 taxonomy. Adding a new event type requires updating this constraint,
-- the Zod schema in event_schemas.ts, and the taxonomy doc.

ALTER TABLE credit_events
  DROP CONSTRAINT IF EXISTS credit_events_event_type_check;

ALTER TABLE credit_events
  ADD CONSTRAINT credit_events_event_type_check
  CHECK (event_type IN (
    'NEWS_EVENT',
    'COVENANT_WAIVER',
    'CEO_DEPARTURE',
    'REVENUE_MISS',
    'GOING_CONCERN',
    'SEC_OTHER',
    'OVERDUE_INVOICE',
    'UTILIZATION_THRESHOLD_BREACH',
    'PAYMENT_DETERIORATION',
    'PAYMENT_IMPROVEMENT',
    'PAYMENT_VOLATILITY',
    'COUNTRY_RATING_CHANGE',
    'COUNTRY_POLITICAL_RISK',
    'COUNTRY_ECONOMIC_SHOCK',
    'INTEREST_RATE_CHANGE',
    'INDUSTRY_DOWNTURN',
    'INDUSTRY_DISRUPTION',
    'REGULATORY_CHANGE',
    'TARIFF_CHANGE',
    'RISK_CHANGE',
    'CONCENTRATION_THRESHOLD_BREACH',
    'PORTFOLIO_INSIGHT',
    'CONCENTRATION_WARNING',
    'EXPANSION_OPPORTUNITY',
    'EMERGING_RISK_SIGNAL',
    'MACRO_TREND_WARNING',
    'FX_EXPOSURE_FLAG',
    'FX_HEDGING_NEEDED',
    'CURRENCY_VOLATILITY'
  ));
