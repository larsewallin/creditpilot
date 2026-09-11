-- Replaces v_ar_aging_current and v_ar_aging_portfolio, which previously read from
-- ar_aging_snapshots (a point-in-time snapshot table that nothing refreshes on a
-- recurring basis, causing silent staleness drift -- confirmed live: the AR Aging
-- page showed data frozen at the date of the last manual refresh, weeks stale,
-- while Credit Events showed correct live-computed OVERDUE_AR data, causing a
-- visible discrepancy between the two pages for the same customer).
--
-- Now computes buckets live from invoices on every query, using the same
-- (CURRENT_DATE - due_date) logic already used in fn_refresh_ar_aging and the
-- ar-aging-agent/cia-agent live-computation fixes from this session. Can never
-- go stale again. ar_aging_snapshots and fn_refresh_ar_aging/fn_refresh_all_ar_aging
-- remain in place (unused by these views now, but not dropped -- out of scope for
-- this change; harmless to leave for now).

CREATE OR REPLACE VIEW v_ar_aging_current AS
SELECT
  c.id AS customer_id,
  c.company_name,
  ti.id_value AS ticker,
  c.account_manager,
  c.scenario,
  c.payment_terms_days,
  CURRENT_DATE AS snapshot_date,
  a.current_amount::bigint AS current_amount,
  a.bucket_1_30::bigint AS bucket_1_30,
  a.bucket_31_60::bigint AS bucket_31_60,
  a.bucket_61_90::bigint AS bucket_61_90,
  a.bucket_over_90::bigint AS bucket_over_90,
  a.pre_petition_amount::bigint AS pre_petition_amount,
  a.total_outstanding::bigint AS total_outstanding,
  a.current_count::integer AS current_count,
  a.bucket_1_30_count::integer AS bucket_1_30_count,
  a.bucket_31_60_count::integer AS bucket_31_60_count,
  a.bucket_61_90_count::integer AS bucket_61_90_count,
  a.bucket_over_90_count::integer AS bucket_over_90_count,
  a.total_invoice_count::integer AS total_invoice_count,
  c.credit_limit,
  CASE WHEN c.credit_limit > 0
    THEN ROUND((a.total_outstanding + a.pre_petition_amount)::NUMERIC / c.credit_limit * 100, 2)
    ELSE NULL END::numeric(6,2) AS utilization_pct,
  CASE
    WHEN a.bucket_over_90 > 0 OR a.pre_petition_amount > 0 THEN 'CRITICAL'
    WHEN a.bucket_61_90 > 0 THEN 'HIGH'
    WHEN a.bucket_31_60 > 0 THEN 'MEDIUM'
    WHEN a.bucket_1_30 > 0 THEN 'LOW'
    ELSE 'CURRENT'
  END AS risk_tier
FROM customers c
LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type = 'ticker' AND ti.is_primary = true
JOIN LATERAL (
  SELECT
    COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) <= 0 AND status = 'current'), 0) AS current_amount,
    COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 1 AND 30 AND status != 'pre_petition'), 0) AS bucket_1_30,
    COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 31 AND 60 AND status != 'pre_petition'), 0) AS bucket_31_60,
    COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 61 AND 90 AND status != 'pre_petition'), 0) AS bucket_61_90,
    COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) > 90 AND status != 'pre_petition'), 0) AS bucket_over_90,
    COALESCE(SUM(outstanding_amount) FILTER (WHERE status = 'pre_petition'), 0) AS pre_petition_amount,
    COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) <= 0 AND status = 'current'), 0)
      + COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 1 AND 30 AND status != 'pre_petition'), 0)
      + COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 31 AND 60 AND status != 'pre_petition'), 0)
      + COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 61 AND 90 AND status != 'pre_petition'), 0)
      + COALESCE(SUM(outstanding_amount) FILTER (WHERE (CURRENT_DATE - due_date) > 90 AND status != 'pre_petition'), 0) AS total_outstanding,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - due_date) <= 0 AND status = 'current') AS current_count,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 1 AND 30 AND status != 'pre_petition') AS bucket_1_30_count,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 31 AND 60 AND status != 'pre_petition') AS bucket_31_60_count,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - due_date) BETWEEN 61 AND 90 AND status != 'pre_petition') AS bucket_61_90_count,
    COUNT(*) FILTER (WHERE (CURRENT_DATE - due_date) > 90 AND status != 'pre_petition') AS bucket_over_90_count,
    COUNT(*) AS total_invoice_count
  FROM invoices
  WHERE customer_id = c.id AND status NOT IN ('paid', 'written_off')
) a ON true
ORDER BY (
  CASE
    WHEN a.bucket_over_90 > 0 OR a.pre_petition_amount > 0 THEN 1
    WHEN a.bucket_61_90 > 0 THEN 2
    WHEN a.bucket_31_60 > 0 THEN 3
    WHEN a.bucket_1_30 > 0 THEN 4
    ELSE 5
  END), a.total_outstanding DESC;

CREATE OR REPLACE VIEW v_ar_aging_portfolio AS
SELECT
  COUNT(DISTINCT customer_id) AS customer_count,
  SUM(current_amount) AS total_current,
  SUM(bucket_1_30) AS total_1_30,
  SUM(bucket_31_60) AS total_31_60,
  SUM(bucket_61_90) AS total_61_90,
  SUM(bucket_over_90) AS total_over_90,
  SUM(pre_petition_amount) AS total_pre_petition,
  SUM(total_outstanding) AS total_outstanding,
  ROUND(SUM(current_amount) / NULLIF(SUM(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_current,
  ROUND(SUM(bucket_1_30) / NULLIF(SUM(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_1_30,
  ROUND(SUM(bucket_31_60) / NULLIF(SUM(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_31_60,
  ROUND(SUM(bucket_61_90) / NULLIF(SUM(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_61_90,
  ROUND(SUM(bucket_over_90) / NULLIF(SUM(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_over_90,
  CURRENT_DATE AS snapshot_date
FROM v_ar_aging_current;
