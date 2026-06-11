-- A3: rename OVERDUE_INVOICE → OVERDUE_AR (per-customer aggregate grain).
-- Migrates any existing OVERDUE_INVOICE rows before recreating the constraint.

BEGIN;

-- Reclassify existing rows so the new constraint doesn't reject them
UPDATE credit_events
SET event_type = 'OVERDUE_AR'
WHERE event_type = 'OVERDUE_INVOICE';

-- Recreate the check constraint with OVERDUE_AR in place of OVERDUE_INVOICE
ALTER TABLE credit_events DROP CONSTRAINT IF EXISTS credit_events_event_type_check;

ALTER TABLE credit_events ADD CONSTRAINT credit_events_event_type_check
  CHECK (event_type IN (
    'NEWS_EVENT',
    'COVENANT_WAIVER',
    'CEO_DEPARTURE',
    'REVENUE_MISS',
    'GOING_CONCERN',
    'SEC_OTHER',
    'OVERDUE_AR',
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

COMMIT;
