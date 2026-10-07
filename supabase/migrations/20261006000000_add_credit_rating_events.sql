-- A7 Credit Rating Change Monitor.
--
-- WHAT: (1) extend credit_events_event_type_check with CREDIT_RATING_DOWNGRADE and
--       CREDIT_RATING_UPGRADE (32 -> 34 values); (2) seed previous rating scores on a few
--       demo customers so the new credit-rating-agent has real changes to report.
-- WHY:  credit-rating-agent emits these two event types; without the CHECK extension
--       every insert would fail with 23514 (same failure mode as 20260930090000).
-- SCOPE: demo customers only (fixed UUIDs). Current scores/raw ratings are NOT changed,
--       only credit_rating_previous_score and credit_rating_updated_at.
--       Triumph 47->32 (medium, action), Heliogen 48->22 (high, action),
--       Spirit AeroSystems 58->52 (low), Bloom Energy 38->45 (upgrade).
-- HOW:  migrate.sh wraps this in a transaction; do not add BEGIN/COMMIT here.

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
    'CREDIT_RATING_DOWNGRADE'::text, 'CREDIT_RATING_UPGRADE'::text
  ])));

UPDATE customers AS c
SET credit_rating_previous_score = v.prev,
    credit_rating_updated_at     = now() - v.age
FROM (VALUES
  ('c0000001-0000-0000-0000-000000000021'::uuid, 47::numeric, interval '4 days'),  -- Triumph Group
  ('c0000001-0000-0000-0000-000000000049'::uuid, 48::numeric, interval '2 days'),  -- Heliogen
  ('c0000001-0000-0000-0000-000000000010'::uuid, 58::numeric, interval '6 days'),  -- Spirit AeroSystems
  ('c0000001-0000-0000-0000-000000000047'::uuid, 38::numeric, interval '5 days')   -- Bloom Energy
) AS v(id, prev, age)
WHERE c.id = v.id;
