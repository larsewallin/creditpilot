-- ticker migration fix: fn_rank_portfolio_risk selected dropped customers.ticker (dead passthrough).
-- DROP+CREATE without ticker (CREATE OR REPLACE cannot change return type).
-- G1 lesson: function bodies are a THIRD reader class beyond code-grep + view pg_depend.
-- Verified: returns the correct 7 high-risk customers.

DROP FUNCTION fn_rank_portfolio_risk();
CREATE FUNCTION public.fn_rank_portfolio_risk()
 RETURNS TABLE(id uuid, company_name text, company_type text, credit_limit bigint, current_exposure bigint, credit_rating_score integer, credit_rating_raw text, credit_rating_source text, scenario scenario_type, risk_tags text[], payment_on_time_rate numeric, payment_trend text, payment_health text, is_high_risk boolean, recent_severity_sum bigint, latest_event_date timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
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
      )
    ) AS is_high_risk,
    COALESCE(sev.recent_severity_sum,0) AS recent_severity_sum,
    COALESCE(sev.latest_event_date, ea.latest_event_date_all) AS latest_event_date
  FROM customers c
  LEFT JOIN latest_snap ls ON ls.customer_id = c.id
  LEFT JOIN going_concern gc ON gc.customer_id = c.id
  LEFT JOIN sev ON sev.customer_id = c.id
  LEFT JOIN evt_any ea ON ea.customer_id = c.id
  ORDER BY
    (
      c.current_exposure > 0 AND (
        c.credit_rating_score < 30
        OR c.scenario = 'bankruptcy'
        OR 'BANKRUPTCY' = ANY(c.risk_tags)
        OR gc.customer_id IS NOT NULL
        OR COALESCE(ls.pre_petition_amount,0) > 0
      )
    ) DESC,
    c.current_exposure DESC,
    COALESCE(sev.recent_severity_sum,0) DESC,
    COALESCE(sev.latest_event_date, ea.latest_event_date_all) DESC NULLS LAST,
    c.company_name
  LIMIT 25;
$function$;
