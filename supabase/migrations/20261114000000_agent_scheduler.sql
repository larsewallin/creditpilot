-- 20261114000000_agent_scheduler.sql
--
-- Every 15 minutes pg_cron calls the agent-scheduler edge function, which starts the
-- monitoring agents each company's Settings › Agent schedules say are due. On a demo
-- project (DEMO_MODE=true) the function starts nothing, so the demo is unchanged.
--
-- The call reads two Vault secrets at run time, never stored in a migration:
--   project_url        e.g. https://<ref>.supabase.co (also used by the sanctions schedule)
--   scheduler_secret   same value as the edge function secret SCHEDULER_SECRET
-- Both are installed by the "Connect scheduler" workflow (scripts/connect-scheduler.sh).
-- Until they exist the job fails harmlessly and nothing else is affected.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.fn_trigger_agent_scheduler()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/agent-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'scheduler_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$$;

REVOKE EXECUTE ON FUNCTION public.fn_trigger_agent_scheduler() FROM PUBLIC, anon, authenticated;

-- Re-running the migration replaces the job rather than adding a second one.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'agent-scheduler';
SELECT cron.schedule('agent-scheduler', '*/15 * * * *', $$SELECT public.fn_trigger_agent_scheduler()$$);
