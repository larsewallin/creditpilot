-- 20261123010000_payment_view_group_on_time.sql
-- "On-time (all)" on the Payments page uses customers.payment_on_time_rate (written by the AR
-- agent with the customer's group rules) when present, so it matches the limit proposal and
-- the assistant. Everything else in the view is unchanged from 20261122020000.
-- migrate.sh wraps this in a transaction; no BEGIN/COMMIT here.

CREATE OR REPLACE VIEW public.v_payment_behaviour_current WITH (security_invoker = true) AS
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
  CASE
    WHEN p.current_txn_count = 0 OR p.prior_txn_count = 0 THEN NULL
    WHEN (p.current_avg_days_late - p.prior_avg_days_late) >= t.swing_days AND p.current_avg_days_late > 0 THEN
      CASE
        WHEN (p.current_avg_days_late - p.prior_avg_days_late) >= t.critical_days THEN 'critical'
        WHEN (p.current_avg_days_late - p.prior_avg_days_late) >= t.high_days THEN 'high'
        ELSE 'medium'
      END
    ELSE NULL
  END AS deterioration_severity,
  CASE
    WHEN p.current_txn_count = 0 OR p.prior_txn_count = 0 THEN NULL
    WHEN (p.prior_avg_days_late - p.current_avg_days_late) >= t.swing_days AND p.prior_avg_days_late > 0 THEN
      CASE WHEN (p.prior_avg_days_late - p.current_avg_days_late) >= t.high_days THEN 'low' ELSE 'info' END
    ELSE NULL
  END AS improvement_severity,
  CASE
    WHEN p.current_txn_count = 0 THEN NULL
    WHEN p.current_stddev_days >= pol.vol_critical THEN 'critical'
    WHEN p.current_stddev_days >= pol.vol_high THEN 'high'
    ELSE NULL
  END AS volatility_severity,
  -- The agents' own figure when there is one: it uses the customer's group rules (a High risk
  -- group has no grace days), which this view cannot read for a demo visitor. The page, the
  -- limit proposal and the assistant then show one on-time rate (review 2026-11-23: Carrick
  -- showed 8% on Actions and 15% here).
  COALESCE(c.payment_on_time_rate,
    CASE WHEN p.total_txn_count > 0
      THEN ROUND(p.all_on_time_count::numeric / p.total_txn_count, 3)
      ELSE NULL END) AS all_time_on_time_rate
FROM public.customers c
CROSS JOIN LATERAL (
  SELECT
    COALESCE((SELECT (value->>'grace_days')::numeric FROM public.company_settings WHERE key = 'policy.payments'), 5)             AS grace,
    COALESCE((SELECT (value->>'swing_pct_of_terms')::numeric FROM public.company_settings WHERE key = 'policy.payment_trend'), 15) AS swing_pct,
    COALESCE((SELECT (value->>'swing_high_pct_of_terms')::numeric FROM public.company_settings WHERE key = 'policy.payment_trend'), 30) AS high_pct,
    COALESCE((SELECT (value->>'swing_critical_pct_of_terms')::numeric FROM public.company_settings WHERE key = 'policy.payment_trend'), 60) AS critical_pct,
    COALESCE((SELECT (value->>'volatility_days')::numeric FROM public.company_settings WHERE key = 'policy.payment_trend'), 10)  AS vol_high,
    COALESCE((SELECT (value->>'volatility_critical_days')::numeric FROM public.company_settings WHERE key = 'policy.payment_trend'), 20) AS vol_critical
) pol
CROSS JOIN LATERAL (
  SELECT
    GREATEST(COALESCE(c.payment_terms_days, 30), 1) * pol.swing_pct / 100    AS swing_days,
    GREATEST(COALESCE(c.payment_terms_days, 30), 1) * pol.high_pct / 100     AS high_days,
    GREATEST(COALESCE(c.payment_terms_days, 30), 1) * pol.critical_pct / 100 AS critical_days
) t
JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90)   AS current_txn_count,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 91 AND 180) AS prior_txn_count,
    COUNT(*)                                                                 AS total_txn_count,
    COUNT(*) FILTER (WHERE days_early_late <= pol.grace)                     AS all_on_time_count,
    AVG(days_early_late) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90)   AS current_avg_days_late,
    AVG(days_early_late) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 91 AND 180) AS prior_avg_days_late,
    STDDEV_POP(days_early_late) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90) AS current_stddev_days,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - payment_date) BETWEEN 0 AND 90 AND days_early_late <= pol.grace) AS current_on_time_count
  FROM public.payment_transactions
  WHERE customer_id = c.id AND days_early_late IS NOT NULL
) p ON true
WHERE c.current_exposure > 0;
