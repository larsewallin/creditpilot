-- Deterministic multi-signal convergence, found during the CIA list-completeness
-- audit. credit_events' fetch in cia-agent was capped at LIMIT 30 (row count, not
-- time-based), which silently cut off real events for customers whose events
-- ranked below the cutoff -- confirmed live: Triumph Group Inc and Atlas Precision
-- Manufacturing's 2nd/3rd events ranked 32/33/35, past the cap, making them
-- invisible to "which customers are flagged by multiple agents" questions even
-- though they genuinely qualify. A real GROUP BY + HAVING aggregation is correct
-- at any table size, unlike inferring convergence from a possibly-incomplete raw
-- event list -- same principle as fn_rank_portfolio_risk and the v_ar_aging_*
-- views: compute deterministically, hand the model the finished answer.
--
-- 90-day window matches fn_rank_portfolio_risk's own severity-scoring window,
-- for consistency. Unlike fn_rank_portfolio_risk (which does not filter by
-- is_demo -- a separate, pre-existing inconsistency, not touched here), this
-- function takes p_is_demo explicitly so it matches the demo/live isolation
-- already enforced by cia-agent's other credit_events queries.

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
    AND ce.customer_id IS NOT NULL
    AND ce.created_at >= now() - interval '90 days'
  GROUP BY ce.customer_id, c.company_name
  HAVING COUNT(DISTINCT ce.source_agent) >= 2
  ORDER BY distinct_agent_count DESC, max_severity_score DESC NULLS LAST, c.company_name;
$$;
