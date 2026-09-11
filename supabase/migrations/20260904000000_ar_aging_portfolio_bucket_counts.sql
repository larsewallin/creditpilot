-- Extends v_ar_aging_portfolio with per-bucket invoice counts (total_current_count,
-- total_bucket_1_30_count, etc.), matching the counts v_ar_aging_current already
-- exposed per-customer (migration 20260811000000) and now surfaced for named-customer
-- and sector AR aging totals in cia-agent. Portfolio-wide invoice counts were the one
-- remaining gap flagged in the list-completeness audit (item #3 follow-up).
--
-- New columns appended at the end of the SELECT list rather than inserted alongside
-- their matching dollar amounts -- CREATE OR REPLACE VIEW only allows appending new
-- columns, not reordering or inserting into the middle of the existing list.

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
  CURRENT_DATE AS snapshot_date,
  SUM(current_count) AS total_current_count,
  SUM(bucket_1_30_count) AS total_bucket_1_30_count,
  SUM(bucket_31_60_count) AS total_bucket_31_60_count,
  SUM(bucket_61_90_count) AS total_bucket_61_90_count,
  SUM(bucket_over_90_count) AS total_bucket_over_90_count
FROM v_ar_aging_current;
