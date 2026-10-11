-- 20261011030000_active_only_portfolio_views.sql
--
-- Phase 0 of New Customer Onboarding: prospects must never appear in portfolio
-- answers. Redefines three objects identically to their current definitions,
-- adding only the filter lifecycle_status = 'active':
--   fn_rank_portfolio_risk (20260922000000), fn_multi_signal_convergence
--   (20260903000000), v_portfolio_overview (baseline).
-- Every existing customer is 'active', so output is unchanged today.

CREATE OR REPLACE FUNCTION public.fn_rank_portfolio_risk() RETURNS TABLE(id uuid, company_name text, company_type text, credit_limit bigint, current_exposure bigint, credit_rating_score integer, credit_rating_raw text, credit_rating_source text, scenario public.scenario_type, risk_tags text[], payment_on_time_rate numeric, payment_trend text, payment_health text, is_high_risk boolean, recent_severity_sum bigint, latest_event_date timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path = public, extensions
    AS $$
  WITH latest_snap AS (
    SELECT DISTINCT ON (customer_id) customer_id, pre_petition_amount
    FROM ar_aging_snapshots ORDER BY customer_id, snapshot_date DESC
  ),
  going_concern AS (
    SELECT DISTINCT customer_id FROM credit_events WHERE event_type = 'GOING_CONCERN'
  ),
  sev AS (
    SELECT customer_id,
           COALESCE(SUM(severity_score),0)::bigint AS recent_severity_sum,
           MAX(created_at) AS latest_event_date
    FROM credit_events
    WHERE created_at >= now() - interval '90 days'
    GROUP BY customer_id
  ),
  evt_any AS (
    SELECT customer_id, MAX(created_at) AS latest_event_date_all
    FROM credit_events GROUP BY customer_id
  )
  SELECT
    c.id, c.company_name, c.company_type,
    c.credit_limit, c.current_exposure, c.credit_rating_score,
    c.credit_rating_raw, c.credit_rating_source, c.scenario,
    c.risk_tags, c.payment_on_time_rate, c.payment_trend, c.payment_health,
    (
      c.current_exposure > 0 AND (
        c.credit_rating_score < 30
        OR c.scenario = 'bankruptcy'
        OR 'BANKRUPTCY' = ANY(c.risk_tags)
        OR gc.customer_id IS NOT NULL
        OR COALESCE(ls.pre_petition_amount,0) > 0
        OR c.payment_health = 'at_risk'
      )
    ) AS is_high_risk,
    COALESCE(sev.recent_severity_sum,0) AS recent_severity_sum,
    COALESCE(sev.latest_event_date, ea.latest_event_date_all) AS latest_event_date
  FROM customers c
  LEFT JOIN latest_snap ls ON ls.customer_id = c.id
  LEFT JOIN going_concern gc ON gc.customer_id = c.id
  LEFT JOIN sev ON sev.customer_id = c.id
  LEFT JOIN evt_any ea ON ea.customer_id = c.id
  WHERE c.lifecycle_status = 'active'
  ORDER BY
    (
      c.current_exposure > 0 AND (
        c.credit_rating_score < 30
        OR c.scenario = 'bankruptcy'
        OR 'BANKRUPTCY' = ANY(c.risk_tags)
        OR gc.customer_id IS NOT NULL
        OR COALESCE(ls.pre_petition_amount,0) > 0
        OR c.payment_health = 'at_risk'
      )
    ) DESC,
    c.current_exposure DESC,
    COALESCE(sev.recent_severity_sum,0) DESC,
    COALESCE(sev.latest_event_date, ea.latest_event_date_all) DESC NULLS LAST,
    c.company_name;
$$;

CREATE OR REPLACE FUNCTION public.fn_multi_signal_convergence(p_is_demo boolean)
RETURNS TABLE(
  customer_id uuid,
  company_name text,
  distinct_agent_count bigint,
  agents text[],
  event_count bigint,
  max_severity_score integer,
  latest_event_date timestamp with time zone
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    ce.customer_id,
    c.company_name,
    COUNT(DISTINCT ce.source_agent) AS distinct_agent_count,
    ARRAY_AGG(DISTINCT ce.source_agent ORDER BY ce.source_agent) AS agents,
    COUNT(*) AS event_count,
    MAX(ce.severity_score) AS max_severity_score,
    MAX(ce.created_at) AS latest_event_date
  FROM credit_events ce
  JOIN customers c ON c.id = ce.customer_id
  WHERE ce.is_demo = p_is_demo
    AND c.lifecycle_status = 'active'
    AND ce.customer_id IS NOT NULL
    AND ce.created_at >= now() - interval '90 days'
  GROUP BY ce.customer_id, c.company_name
  HAVING COUNT(DISTINCT ce.source_agent) >= 2
  ORDER BY distinct_agent_count DESC, max_severity_score DESC NULLS LAST, c.company_name;
$$;

CREATE OR REPLACE VIEW public.v_portfolio_overview AS
 SELECT count(*) AS total_customers,
    sum(credit_limit) AS total_credit_limits,
    sum(current_exposure) AS total_exposure,
    round(avg(credit_limit)) AS avg_credit_limit,
    round(((sum(current_exposure) / NULLIF(sum(credit_limit), (0)::numeric)) * (100)::numeric), 1) AS portfolio_utilization_pct,
    count(*) FILTER (WHERE (scenario = 'normal_operations'::public.scenario_type)) AS normal_count,
    count(*) FILTER (WHERE (scenario = 'payment_issues'::public.scenario_type)) AS payment_issues_count,
    count(*) FILTER (WHERE (scenario = 'credit_deterioration'::public.scenario_type)) AS credit_deterioration_count,
    count(*) FILTER (WHERE (scenario = 'negative_news'::public.scenario_type)) AS negative_news_count,
    count(*) FILTER (WHERE (scenario = 'bankruptcy'::public.scenario_type)) AS bankruptcy_count,
    count(*) FILTER (WHERE (scenario = 'growth_opportunity'::public.scenario_type)) AS growth_count,
    count(*) FILTER (WHERE (scenario = 'sec_filing_monitoring'::public.scenario_type)) AS sec_monitoring_count,
    count(*) FILTER (WHERE ((current_exposure > 0) AND ((credit_rating_score < 30) OR (scenario = 'bankruptcy'::public.scenario_type) OR ('BANKRUPTCY'::text = ANY (risk_tags)) OR (EXISTS ( SELECT 1
           FROM public.credit_events e
          WHERE ((e.customer_id = customers.id) AND (e.event_type = 'GOING_CONCERN'::text)))) OR (COALESCE(( SELECT s.pre_petition_amount
           FROM public.ar_aging_snapshots s
          WHERE (s.customer_id = customers.id)
          ORDER BY s.snapshot_date DESC
         LIMIT 1), (0)::bigint) > 0)))) AS high_risk_count
   FROM public.customers
  WHERE lifecycle_status = 'active';
