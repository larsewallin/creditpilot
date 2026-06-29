-- ticker migration: rewrite 7 views to source ticker from customer_identifiers
-- LEFT JOIN customer_identifiers primary ticker instead of customers.ticker.
-- Verified: all 7 views row and non-null-ticker counts identical to pre-change baseline.


CREATE OR REPLACE VIEW v_ar_aging_current AS
SELECT c.id AS customer_id, c.company_name, ti.id_value AS ticker, c.account_manager,
  c.scenario, c.payment_terms_days, a.snapshot_date, a.current_amount, a.bucket_1_30,
  a.bucket_31_60, a.bucket_61_90, a.bucket_over_90, a.pre_petition_amount, a.total_outstanding,
  a.current_count, a.bucket_1_30_count, a.bucket_31_60_count, a.bucket_61_90_count,
  a.bucket_over_90_count, a.total_invoice_count, a.credit_limit, a.utilization_pct,
  CASE WHEN a.bucket_over_90 > 0 OR a.pre_petition_amount > 0 THEN 'CRITICAL'::text
    WHEN a.bucket_61_90 > 0 THEN 'HIGH'::text WHEN a.bucket_31_60 > 0 THEN 'MEDIUM'::text
    WHEN a.bucket_1_30 > 0 THEN 'LOW'::text ELSE 'CURRENT'::text END AS risk_tier
FROM customers c
  LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type='ticker' AND ti.is_primary = true
  JOIN LATERAL (SELECT s.id, s.customer_id, s.snapshot_date, s.current_amount, s.bucket_1_30,
    s.bucket_31_60, s.bucket_61_90, s.bucket_over_90, s.total_outstanding, s.current_count,
    s.bucket_1_30_count, s.bucket_31_60_count, s.bucket_61_90_count, s.bucket_over_90_count,
    s.total_invoice_count, s.pre_petition_amount, s.credit_limit, s.utilization_pct,
    s.generated_by, s.created_at
    FROM ar_aging_snapshots s WHERE s.customer_id = c.id ORDER BY s.snapshot_date DESC LIMIT 1) a ON true
ORDER BY (CASE WHEN a.bucket_over_90 > 0 OR a.pre_petition_amount > 0 THEN 1
  WHEN a.bucket_61_90 > 0 THEN 2 WHEN a.bucket_31_60 > 0 THEN 3
  WHEN a.bucket_1_30 > 0 THEN 4 ELSE 5 END), a.total_outstanding DESC;

CREATE OR REPLACE VIEW v_bankruptcy_claims AS
SELECT c.company_name, ti.id_value AS ticker, bd.filing_date, bd.case_number, bd.court,
  bd.chapter, bd.status, bd.proof_of_claim_filed, bd.proof_of_claim_amount,
  bd.estimated_recovery_rate, bd.estimated_recovery_amount, bd.total_pre_petition_claim,
  bd.emergence_date_estimated,
  (SELECT count(*) FROM invoices i WHERE i.customer_id = c.id AND i.claimable = true) AS claimable_invoice_count,
  (SELECT COALESCE(sum(i.amount_outstanding), 0::numeric) FROM invoices i WHERE i.customer_id = c.id AND i.claimable = true) AS claimable_total
FROM customers c
  LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type='ticker' AND ti.is_primary = true
  JOIN bankruptcy_details bd ON bd.customer_id = c.id
ORDER BY bd.filing_date DESC;

CREATE OR REPLACE VIEW v_growth_opportunities AS
SELECT c.id, c.company_name, ti.id_value AS ticker, c.credit_limit, c.current_exposure,
  c.account_manager, gs.growth_trajectory, gs.revenue_growth_yoy, gs.backlog_amount,
  gs.recommended_new_limit, gs.rationale, gs.upsell_opportunity, gs.recent_milestones
FROM customers c
  LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type='ticker' AND ti.is_primary = true
  JOIN growth_signals gs ON gs.customer_id = c.id
WHERE gs.credit_limit_increase_recommended = true
ORDER BY gs.recommended_new_limit DESC;

CREATE OR REPLACE VIEW v_overdue_invoices AS
SELECT c.company_name, ti.id_value AS ticker, c.scenario, c.account_manager, i.invoice_number,
  i.invoice_amount, i.amount_paid, i.amount_outstanding, i.invoice_date, i.due_date,
  i.days_overdue, i.status, i.dunning_stage, i.escalated_to_collections, i.claimable,
  CASE WHEN i.days_overdue >= 90 THEN 'CRITICAL'::text WHEN i.days_overdue >= 60 THEN 'SEVERE'::text
    WHEN i.days_overdue >= 30 THEN 'WARNING'::text ELSE 'MONITOR'::text END AS risk_tier
FROM invoices i
  JOIN customers c ON c.id = i.customer_id
  LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type='ticker' AND ti.is_primary = true
WHERE i.days_overdue > 0
ORDER BY i.days_overdue DESC;

CREATE OR REPLACE VIEW v_payment_behaviour AS
SELECT c.id AS customer_id, c.company_name, ti.id_value AS ticker, c.payment_terms_days,
  c.account_manager, count(pt.id) AS total_payments,
  COALESCE(sum(pt.amount_paid), 0::numeric) AS total_paid_all_time,
  COALESCE(sum(pt.amount_paid) FILTER (WHERE pt.payment_date >= (CURRENT_DATE - '1 year'::interval)), 0::numeric) AS total_paid_12mo,
  round(avg(pt.days_to_pay), 1) AS avg_days_to_pay,
  round(avg(pt.days_early_late), 1) AS avg_days_early_late,
  round(avg(CASE WHEN pt.on_time THEN 1.0 ELSE 0.0 END) * 100::numeric, 1) AS on_time_payment_pct,
  max(pt.payment_date) AS last_payment_date,
  (SELECT payment_transactions.amount_paid FROM payment_transactions WHERE payment_transactions.customer_id = c.id ORDER BY payment_transactions.payment_date DESC LIMIT 1) AS last_payment_amount,
  round(avg(pt.days_to_pay) FILTER (WHERE pt.payment_date >= (CURRENT_DATE - '6 mons'::interval)), 1) AS avg_days_to_pay_last_6mo,
  round(avg(pt.days_to_pay) FILTER (WHERE pt.payment_date >= (CURRENT_DATE - '1 year'::interval) AND pt.payment_date <= (CURRENT_DATE - '6 mons'::interval)), 1) AS avg_days_to_pay_prior_6mo
FROM customers c
  LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type='ticker' AND ti.is_primary = true
  LEFT JOIN payment_transactions pt ON pt.customer_id = c.id
GROUP BY c.id, c.company_name, ti.id_value, c.payment_terms_days, c.account_manager;

CREATE OR REPLACE VIEW v_customers_at_risk AS
SELECT c.id, c.company_name, ti.id_value AS ticker, c.scenario, c.credit_limit, c.current_exposure,
  round(c.current_exposure::numeric / NULLIF(c.credit_limit, 0)::numeric * 100::numeric, 1) AS utilization_pct,
  c.credit_rating_score, c.notes, c.account_manager,
  (SELECT round(avg(pt.days_early_late)) FROM payment_transactions pt WHERE pt.customer_id = c.id) AS avg_days_early_late,
  (SELECT round(avg(CASE WHEN pt.on_time THEN 1.0 ELSE 0.0 END) * 100::numeric, 1) FROM payment_transactions pt WHERE pt.customer_id = c.id) AS on_time_pct,
  (SELECT count(*) FROM invoices i WHERE i.customer_id = c.id AND i.days_overdue > 0) AS overdue_invoice_count,
  (SELECT COALESCE(sum(i.amount_outstanding), 0::numeric) FROM invoices i WHERE i.customer_id = c.id AND i.days_overdue > 0) AS overdue_amount,
  (SELECT max(i.days_overdue) FROM invoices i WHERE i.customer_id = c.id) AS max_days_overdue
FROM customers c
  LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type='ticker' AND ti.is_primary = true
WHERE c.current_exposure > 0 AND (c.credit_rating_score < 30 OR c.scenario = 'bankruptcy'::scenario_type
  OR ('BANKRUPTCY'::text = ANY (c.risk_tags))
  OR (EXISTS (SELECT 1 FROM credit_events e WHERE e.customer_id = c.id AND e.event_type = 'GOING_CONCERN'::text))
  OR COALESCE((SELECT s.pre_petition_amount FROM ar_aging_snapshots s WHERE s.customer_id = c.id ORDER BY s.snapshot_date DESC LIMIT 1), 0::bigint) > 0)
ORDER BY c.current_exposure DESC;

CREATE OR REPLACE VIEW v_sec_monitoring_dashboard AS
SELECT c.id AS customer_id, c.company_name, ti.id_value AS ticker, sm.cik, sm.monitoring_active,
  sm.last_10k_date, sm.last_10q_date, sm.last_8k_date, sm.risk_signals_detected,
  sm.alert_triggered, sm.alert_date, sm.alert_action_taken, sm.next_scheduled_review,
  (SELECT count(*) FROM sec_filings sf WHERE sf.customer_id = c.id) AS total_filings,
  (SELECT count(*) FROM sec_filings sf WHERE sf.customer_id = c.id AND sf.reviewed = false) AS unreviewed_filings
FROM customers c
  LEFT JOIN customer_identifiers ti ON ti.customer_id = c.id AND ti.id_type='ticker' AND ti.is_primary = true
  JOIN sec_monitoring sm ON sm.customer_id = c.id
WHERE sm.monitoring_active = true
ORDER BY sm.alert_triggered DESC, sm.last_10q_date DESC;


