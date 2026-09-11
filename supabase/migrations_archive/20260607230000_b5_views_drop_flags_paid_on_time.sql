-- B5 deferred view work + B0 final column drops. Decision date: 2026-06-07.
-- Verified via dry-run: v_customers_at_risk returns the 7 high-risk customers,
-- high_risk_count=7 (consistent with fn_rank_portfolio_risk), columns dropped clean.
-- Rewrites 3 views off flags/paid_on_time, then drops both columns.
--   v_payment_behaviour    — mechanical: paid_on_time -> on_time
--   v_customers_at_risk     — rewrite to V1 high-risk membership (matches fn_rank_portfolio_risk);
--                             drop dead credit_metrics join; paid_on_time -> on_time
--   v_portfolio_overview    — replace flag counters with high_risk_count (V1 predicate)
-- Then: DROP customers.flags, payment_transactions.paid_on_time (+ its index).

BEGIN;

-- ── 1. v_payment_behaviour (mechanical paid_on_time -> on_time) ──
DROP VIEW v_payment_behaviour;
CREATE VIEW v_payment_behaviour AS
 SELECT c.id AS customer_id, c.company_name, c.ticker, c.payment_terms_days, c.account_manager,
    count(pt.id) AS total_payments,
    COALESCE(sum(pt.amount_paid), 0::numeric) AS total_paid_all_time,
    COALESCE(sum(pt.amount_paid) FILTER (WHERE pt.payment_date >= (CURRENT_DATE - '1 year'::interval)), 0::numeric) AS total_paid_12mo,
    round(avg(pt.days_to_pay), 1) AS avg_days_to_pay,
    round(avg(pt.days_early_late), 1) AS avg_days_early_late,
    round(avg(CASE WHEN pt.on_time THEN 1.0 ELSE 0.0 END) * 100::numeric, 1) AS on_time_payment_pct,
    max(pt.payment_date) AS last_payment_date,
    ( SELECT payment_transactions.amount_paid FROM payment_transactions
       WHERE payment_transactions.customer_id = c.id
       ORDER BY payment_transactions.payment_date DESC LIMIT 1) AS last_payment_amount,
    round(avg(pt.days_to_pay) FILTER (WHERE pt.payment_date >= (CURRENT_DATE - '6 mons'::interval)), 1) AS avg_days_to_pay_last_6mo,
    round(avg(pt.days_to_pay) FILTER (WHERE pt.payment_date >= (CURRENT_DATE - '1 year'::interval) AND pt.payment_date <= (CURRENT_DATE - '6 mons'::interval)), 1) AS avg_days_to_pay_prior_6mo
   FROM customers c
     LEFT JOIN payment_transactions pt ON pt.customer_id = c.id
  GROUP BY c.id, c.company_name, c.ticker, c.payment_terms_days, c.account_manager;

-- ── 2. v_customers_at_risk (V1 high-risk membership; on_time; no credit_metrics) ──
DROP VIEW v_customers_at_risk;
CREATE VIEW v_customers_at_risk AS
 SELECT c.id, c.company_name, c.ticker, c.scenario, c.credit_limit, c.current_exposure,
    round(c.current_exposure::numeric / NULLIF(c.credit_limit, 0)::numeric * 100::numeric, 1) AS utilization_pct,
    c.credit_rating_score, c.notes, c.account_manager,
    ( SELECT round(avg(pt.days_early_late)) FROM payment_transactions pt
       WHERE pt.customer_id = c.id) AS avg_days_early_late,
    ( SELECT round(avg(CASE WHEN pt.on_time THEN 1.0 ELSE 0.0 END) * 100::numeric, 1)
       FROM payment_transactions pt WHERE pt.customer_id = c.id) AS on_time_pct,
    ( SELECT count(*) FROM invoices i WHERE i.customer_id = c.id AND i.days_overdue > 0) AS overdue_invoice_count,
    ( SELECT COALESCE(sum(i.amount_outstanding), 0::numeric) FROM invoices i
       WHERE i.customer_id = c.id AND i.days_overdue > 0) AS overdue_amount,
    ( SELECT max(i.days_overdue) FROM invoices i WHERE i.customer_id = c.id) AS max_days_overdue
   FROM customers c
  -- V1 high-risk membership rule (CreditPilot_Risk_Ranking_Priority_V1.md; matches fn_rank_portfolio_risk):
  WHERE c.current_exposure > 0
    AND (
      c.credit_rating_score < 30
      OR c.scenario = 'bankruptcy'
      OR 'BANKRUPTCY' = ANY(c.risk_tags)
      OR EXISTS (SELECT 1 FROM credit_events e WHERE e.customer_id = c.id AND e.event_type = 'GOING_CONCERN')
      OR COALESCE((SELECT s.pre_petition_amount FROM ar_aging_snapshots s
                   WHERE s.customer_id = c.id ORDER BY s.snapshot_date DESC LIMIT 1), 0) > 0
    )
  ORDER BY c.current_exposure DESC;

-- ── 3. v_portfolio_overview (flag counters -> high_risk_count) ──
DROP VIEW v_portfolio_overview;
CREATE VIEW v_portfolio_overview AS
 SELECT count(*) AS total_customers,
    sum(credit_limit) AS total_credit_limits,
    sum(current_exposure) AS total_exposure,
    round(avg(credit_limit)) AS avg_credit_limit,
    round(sum(current_exposure) / NULLIF(sum(credit_limit), 0::numeric) * 100::numeric, 1) AS portfolio_utilization_pct,
    count(*) FILTER (WHERE scenario = 'normal_operations'::scenario_type) AS normal_count,
    count(*) FILTER (WHERE scenario = 'payment_issues'::scenario_type) AS payment_issues_count,
    count(*) FILTER (WHERE scenario = 'credit_deterioration'::scenario_type) AS credit_deterioration_count,
    count(*) FILTER (WHERE scenario = 'negative_news'::scenario_type) AS negative_news_count,
    count(*) FILTER (WHERE scenario = 'bankruptcy'::scenario_type) AS bankruptcy_count,
    count(*) FILTER (WHERE scenario = 'growth_opportunity'::scenario_type) AS growth_count,
    count(*) FILTER (WHERE scenario = 'sec_filing_monitoring'::scenario_type) AS sec_monitoring_count,
    -- V1 high-risk set count (replaces flag-based watch_list_count/credit_hold_count):
    count(*) FILTER (WHERE current_exposure > 0 AND (
        credit_rating_score < 30
        OR scenario = 'bankruptcy'
        OR 'BANKRUPTCY' = ANY(risk_tags)
        OR EXISTS (SELECT 1 FROM credit_events e WHERE e.customer_id = customers.id AND e.event_type = 'GOING_CONCERN')
        OR COALESCE((SELECT s.pre_petition_amount FROM ar_aging_snapshots s
                     WHERE s.customer_id = customers.id ORDER BY s.snapshot_date DESC LIMIT 1), 0) > 0
      )) AS high_risk_count
   FROM customers;

-- ── 4. Drop the now-unreferenced columns ──
DROP INDEX IF EXISTS idx_pmttxn_on_time;
ALTER TABLE payment_transactions DROP COLUMN paid_on_time;
ALTER TABLE customers DROP COLUMN flags;

COMMIT;
