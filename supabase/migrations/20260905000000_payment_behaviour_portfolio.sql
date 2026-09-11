-- Closes the last piece of the arithmetic-reliability sweep deferred back when
-- sector/named-customer payment behavior totals were built (v_payment_behaviour):
-- there was no deterministic portfolio-wide payment behavior aggregate, so a
-- portfolio-wide "average days to pay across the whole portfolio" question had
-- nothing to fall back on except averaging raw transactions or per-customer
-- averages in cia-agent -- the exact averaging-of-averages mistake this project's
-- arithmetic-reliability rule exists to prevent.
--
-- Computes directly from payment_transactions (not by aggregating the
-- already-averaged per-customer v_payment_behaviour rows), so AVG() here is
-- inherently volume-weighted with no special weighting logic needed. Deliberately
-- not filtering by is_demo, matching v_payment_behaviour's existing pattern.

CREATE VIEW v_payment_behaviour_portfolio AS
SELECT
  COUNT(DISTINCT customer_id) AS customer_count,
  COUNT(*) AS total_payments,
  COALESCE(SUM(amount_paid), 0) AS total_paid_all_time,
  COALESCE(SUM(amount_paid) FILTER (WHERE payment_date >= CURRENT_DATE - INTERVAL '1 year'), 0) AS total_paid_12mo,
  ROUND(AVG(days_to_pay), 1) AS avg_days_to_pay,
  ROUND(AVG(days_early_late), 1) AS avg_days_early_late,
  ROUND(AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100, 1) AS on_time_payment_pct,
  MAX(payment_date) AS last_payment_date
FROM payment_transactions;
