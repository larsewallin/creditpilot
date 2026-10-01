-- Widen v_payment_behaviour_current's comparison windows from 30/30 days to
-- 90/90 days, to match the same change in
-- _shared/skills/analytical/analyse-payment-trend.ts (OBSERVATION_WINDOW_DAYS).
--
-- Why: demo (and much real) payment data arrives roughly monthly, so a
-- 30-day window usually captured exactly one transaction per side. Stddev of
-- a single value is always 0 (Volatility showed 0 for every customer), and
-- an on-time rate computed over one transaction is binary (On-time showed
-- only 0% or 100%, never anything in between). Both stats need at least a
-- couple of samples per window to mean anything.
--
-- This view is deliberately kept in lockstep with the skill (see that
-- migration's and that file's own comments) so the Payments page never shows
-- numbers computed on a different window than the DETERIORATION/IMPROVEMENT/
-- VOLATILITY events payment-behaviour-agent actually wrote to credit_events.
--
--   current window = payment_date within the last 90 days (inclusive)
--   prior window   = payment_date 91..180 days ago
-- (was 30 / 31..60)

CREATE OR REPLACE VIEW v_payment_behaviour_current AS
SELECT
  c.id AS customer_id,
  c.company_name,
  c.sector,
  c.scenario,
  c.credit_limit,
  c.current_exposure,
  c.payment_terms_days,
  c.payment_health,
  p.current_txn_count::integer  AS current_txn_count,
  p.prior_txn_count::integer    AS prior_txn_count,
  p.total_txn_count::integer    AS total_txn_count,
  ROUND(p.current_avg_days_late::numeric, 1)  AS current_avg_days_late,
  ROUND(p.prior_avg_days_late::numeric, 1)    AS prior_avg_days_late,
  CASE WHEN p.current_txn_count > 0 AND p.prior_txn_count > 0
    THEN ROUND((p.current_avg_days_late - p.prior_avg_days_late)::numeric, 1)
    ELSE NULL END AS delta_days_late,
  ROUND(p.current_stddev_days::numeric, 1)    AS current_stddev_days,
  CASE WHEN p.current_txn_count > 0
    THEN ROUND(p.current_on_time_count::numeric / p.current_txn_count, 3)
    ELSE NULL END AS current_on_time_rate,
  (p.current_txn_count > 0 AND p.prior_txn_count > 0) AS has_sufficient_data,
  -- Mirrors analyse-payment-trend.ts's firing rules exactly, so the page's
  -- labelling agrees with what the agent actually emitted rather than
  -- re-deriving a second, subtly different opinion.
  CASE
    WHEN p.current_txn_count = 0 OR p.prior_txn_count = 0 THEN NULL
    WHEN (p.current_avg_days_late - p.prior_avg_days_late) >= 5 AND p.current_avg_days_late > 0 THEN
      CASE
        WHEN (p.current_avg_days_late - p.prior_avg_days_late) >= 20 THEN 'critical'
        WHEN (p.current_avg_days_late - p.prior_avg_days_late) >= 10 THEN 'high'
        ELSE 'medium'
      END
    ELSE NULL
  END AS deterioration_severity,
  CASE
    WHEN p.current_txn_count = 0 OR p.prior_txn_count = 0 THEN NULL
    WHEN (p.prior_avg_days_late - p.current_avg_days_late) >= 5 AND p.prior_avg_days_late > 0 THEN
      CASE WHEN (p.prior_avg_days_late - p.current_avg_days_late) >= 10 THEN 'low' ELSE 'info' END
    ELSE NULL
  END AS improvement_severity,
  CASE
    WHEN p.current_txn_count = 0 THEN NULL
    WHEN p.current_stddev_days >= 20 THEN 'critical'
    WHEN p.current_stddev_days >= 10 THEN 'high'
    ELSE NULL
  END AS volatility_severity
FROM customers c
JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90)   AS current_txn_count,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 91 AND 180) AS prior_txn_count,
    COUNT(*)                                                                 AS total_txn_count,
    AVG(days_early_late) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90)   AS current_avg_days_late,
    AVG(days_early_late) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 91 AND 180) AS prior_avg_days_late,
    STDDEV_POP(days_early_late) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90) AS current_stddev_days,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90 AND days_early_late <= 0) AS current_on_time_count
  FROM payment_transactions
  WHERE customer_id = c.id AND days_early_late IS NOT NULL
) p ON true
WHERE c.current_exposure > 0;
