-- Adds payment_health = 'at_risk' as a new OR-condition in fn_rank_portfolio_risk's
-- high-risk membership gate, alongside the existing bankruptcy OR-list
-- (scenario='bankruptcy' / 'BANKRUPTCY' risk_tag / GOING_CONCERN event /
-- pre_petition_amount > 0).
--
-- Why: credit_rating_score comes only from external rating providers
-- (aggregate-credit-scores.ts) and has zero input from payment behaviour.
-- payment_health is a separate, independently-computed signal
-- (analyse-payment-behaviour.ts: 'at_risk' = deteriorating trend AND
-- on_time_rate < 0.85 -- i.e. actively, currently getting worse, not just
-- occasionally late) that the ranking function already SELECTs and displays
-- but never gated on. A customer who is genuinely a bad, worsening payer but
-- happens to have a decent bureau score and no bankruptcy signal was
-- invisible to the "highest risk" answer. This mirrors how D&B's PAYDEX
-- sits alongside a bureau score rather than being folded into it -- payment
-- behaviour is checked as its own categorical signal, same pattern as the
-- existing bankruptcy OR-list.
--
-- Ranking (severity sum / recency) is unchanged here. Overdue-AR events
-- (once the AR agent's overdue half is built -- backlog A3/B4) will flow
-- into the existing 90-day severity sum automatically, per the locked V1
-- design's "new event types need no ranking-formula changes" principle --
-- no further change to this function is expected for that piece.

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
