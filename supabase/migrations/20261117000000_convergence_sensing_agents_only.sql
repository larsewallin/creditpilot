-- fn_multi_signal_convergence feeds CIA's "OFFICIAL" multi-signal facts. It counted
-- cia-agent's own COMPOSITE_RISK_* rows as one more "agent" and counted every
-- repeated assessment as another event (204 composite rows for 21 customers on
-- 2026-11-17). Count only the sensing agents' current (not archived) events.
CREATE OR REPLACE FUNCTION public.fn_multi_signal_convergence(p_is_demo boolean)
RETURNS TABLE(customer_id uuid, company_name text, distinct_agent_count bigint, agents text[], event_count bigint, max_severity_score integer, latest_event_date timestamp with time zone)
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
    AND ce.source_agent <> 'cia-agent'
    AND ce.source_agent <> 'onboarding'
    AND ce.archived_at IS NULL
    AND ce.created_at >= now() - interval '90 days'
  GROUP BY ce.customer_id, c.company_name
  HAVING COUNT(DISTINCT ce.source_agent) >= 2
  ORDER BY distinct_agent_count DESC, max_severity_score DESC NULLS LAST, c.company_name;
$$;
