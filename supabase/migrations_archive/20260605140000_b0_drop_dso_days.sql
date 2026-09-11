-- B0 Phase 3a-ter: drop ar_aging_snapshots.dso_days + rewrite the two views that pass it through.
-- Decision date: 2026-06-05. Data/schema-only. Verified via dry-run: both views return
-- rows, portfolio totals match (total_outstanding 77,897,000 = current+buckets, excl.
-- pre_petition by fn_refresh_ar_aging's existing definition — see backlog F4). dso_days
-- has no readers (only matched the CIA question-routing regex). Compute at read time if
-- ever needed. paid_on_time + flags deferred to B5 (entangled with v_customers_at_risk).

BEGIN;

DROP VIEW v_ar_aging_current;
CREATE VIEW v_ar_aging_current AS
 SELECT c.id AS customer_id,
    c.company_name,
    c.ticker,
    c.account_manager,
    c.scenario,
    c.payment_terms_days,
    a.snapshot_date,
    a.current_amount,
    a.bucket_1_30,
    a.bucket_31_60,
    a.bucket_61_90,
    a.bucket_over_90,
    a.pre_petition_amount,
    a.total_outstanding,
    a.current_count,
    a.bucket_1_30_count,
    a.bucket_31_60_count,
    a.bucket_61_90_count,
    a.bucket_over_90_count,
    a.total_invoice_count,
    a.credit_limit,
    a.utilization_pct,
        CASE
            WHEN a.bucket_over_90 > 0 OR a.pre_petition_amount > 0 THEN 'CRITICAL'::text
            WHEN a.bucket_61_90 > 0 THEN 'HIGH'::text
            WHEN a.bucket_31_60 > 0 THEN 'MEDIUM'::text
            WHEN a.bucket_1_30 > 0 THEN 'LOW'::text
            ELSE 'CURRENT'::text
        END AS risk_tier
   FROM customers c
     JOIN LATERAL ( SELECT s.id,
            s.customer_id,
            s.snapshot_date,
            s.current_amount,
            s.bucket_1_30,
            s.bucket_31_60,
            s.bucket_61_90,
            s.bucket_over_90,
            s.total_outstanding,
            s.current_count,
            s.bucket_1_30_count,
            s.bucket_31_60_count,
            s.bucket_61_90_count,
            s.bucket_over_90_count,
            s.total_invoice_count,
            s.pre_petition_amount,
            s.credit_limit,
            s.utilization_pct,
            s.generated_by,
            s.created_at
           FROM ar_aging_snapshots s
          WHERE s.customer_id = c.id
          ORDER BY s.snapshot_date DESC
         LIMIT 1) a ON true
  ORDER BY (
        CASE
            WHEN a.bucket_over_90 > 0 OR a.pre_petition_amount > 0 THEN 1
            WHEN a.bucket_61_90 > 0 THEN 2
            WHEN a.bucket_31_60 > 0 THEN 3
            WHEN a.bucket_1_30 > 0 THEN 4
            ELSE 5
        END), a.total_outstanding DESC;

DROP VIEW v_ar_aging_portfolio;
CREATE VIEW v_ar_aging_portfolio AS
 SELECT count(DISTINCT customer_id) AS customer_count,
    sum(current_amount) AS total_current,
    sum(bucket_1_30) AS total_1_30,
    sum(bucket_31_60) AS total_31_60,
    sum(bucket_61_90) AS total_61_90,
    sum(bucket_over_90) AS total_over_90,
    sum(pre_petition_amount) AS total_pre_petition,
    sum(total_outstanding) AS total_outstanding,
    round(sum(current_amount) / NULLIF(sum(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_current,
    round(sum(bucket_1_30) / NULLIF(sum(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_1_30,
    round(sum(bucket_31_60) / NULLIF(sum(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_31_60,
    round(sum(bucket_61_90) / NULLIF(sum(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_61_90,
    round(sum(bucket_over_90) / NULLIF(sum(total_outstanding), 0::numeric) * 100::numeric, 1) AS pct_over_90,
    snapshot_date
   FROM ( SELECT DISTINCT ON (ar_aging_snapshots.customer_id) ar_aging_snapshots.id,
            ar_aging_snapshots.customer_id,
            ar_aging_snapshots.snapshot_date,
            ar_aging_snapshots.current_amount,
            ar_aging_snapshots.bucket_1_30,
            ar_aging_snapshots.bucket_31_60,
            ar_aging_snapshots.bucket_61_90,
            ar_aging_snapshots.bucket_over_90,
            ar_aging_snapshots.total_outstanding,
            ar_aging_snapshots.current_count,
            ar_aging_snapshots.bucket_1_30_count,
            ar_aging_snapshots.bucket_31_60_count,
            ar_aging_snapshots.bucket_61_90_count,
            ar_aging_snapshots.bucket_over_90_count,
            ar_aging_snapshots.total_invoice_count,
            ar_aging_snapshots.pre_petition_amount,
            ar_aging_snapshots.credit_limit,
            ar_aging_snapshots.utilization_pct,
            ar_aging_snapshots.generated_by,
            ar_aging_snapshots.created_at
           FROM ar_aging_snapshots
          ORDER BY ar_aging_snapshots.customer_id, ar_aging_snapshots.snapshot_date DESC) latest
  GROUP BY snapshot_date;

ALTER TABLE ar_aging_snapshots DROP COLUMN dso_days;

COMMIT;
