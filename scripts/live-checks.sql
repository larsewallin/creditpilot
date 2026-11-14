-- scripts/live-checks.sql — read-only health checks on production.
-- Run by the Deploy workflow inside a READ ONLY transaction; prints results to
-- the run log. Counts only: no names, emails or amounts (the repo is public).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on" -f scripts/live-checks.sql

\echo '== F5: pending actions duplicated for the same customer + action (expect 0)'
SELECT count(*) AS duplicate_groups
FROM (
  SELECT customer_id, action_type, is_demo
  FROM pending_actions
  WHERE status = 'pending'
  GROUP BY customer_id, action_type, is_demo
  HAVING count(*) > 1
) d;

\echo '== F3: payment behaviour events, last 30 days (PAYMENT_VOLATILITY should appear)'
SELECT event_type, count(*) AS events
FROM credit_events
WHERE event_type IN ('PAYMENT_DETERIORATION', 'PAYMENT_IMPROVEMENT', 'PAYMENT_VOLATILITY')
  AND created_at > now() - interval '30 days'
GROUP BY event_type
ORDER BY event_type;

\echo '== Events by source agent, last 7 days'
SELECT coalesce(source_agent, '(none)') AS source_agent, count(*) AS events
FROM credit_events
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;

\echo '== Customers by lifecycle status'
SELECT lifecycle_status, count(*) AS customers
FROM customers
GROUP BY 1
ORDER BY 1;

\echo '== Score source on active customers'
SELECT coalesce(credit_rating_source, '(none)') AS source, count(*) AS customers
FROM customers
WHERE lifecycle_status = 'active'
GROUP BY 1
ORDER BY 2 DESC;

\echo '— Agent scheduler: cron job, Vault names (names only), recent calls —'
SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('agent-scheduler') ORDER BY jobname;
SELECT name FROM vault.secrets WHERE name IN ('project_url', 'scheduler_secret', 'sanctions_sync_secret') ORDER BY name;
SELECT agent_name, count(*) AS starts_7d, max(started_at) AS last_start
  FROM agent_runs WHERE agent_name LIKE 'scheduler:%' AND started_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1;
