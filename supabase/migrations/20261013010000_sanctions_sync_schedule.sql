-- 20261013010000_sanctions_sync_schedule.sql
--
-- Runs sanctions-sync every day, one list per job (staggered), so a slow or
-- failing list never blocks the others. Screening refuses to run once any list
-- is more than 3 days old, so this schedule is part of the compliance control.
--
-- The jobs read two secrets from Supabase Vault at run time (set once per
-- project by the founder, never in a migration):
--   project_url            e.g. https://<ref>.supabase.co
--   sanctions_sync_secret  same value as the edge function secret SANCTIONS_SYNC_SECRET
-- Until both exist the jobs fail harmlessly and nothing else is affected.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.fn_trigger_sanctions_sync(p_list text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sanctions-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sanctions_sync_secret')),
    body := jsonb_build_object('lists', jsonb_build_array(p_list)),
    timeout_milliseconds := 120000);
$$;

REVOKE EXECUTE ON FUNCTION public.fn_trigger_sanctions_sync(text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('sanctions-sync-ofac-sdn',  '5 6 * * *',  $$SELECT public.fn_trigger_sanctions_sync('OFAC_SDN')$$);
SELECT cron.schedule('sanctions-sync-ofac-cons', '10 6 * * *', $$SELECT public.fn_trigger_sanctions_sync('OFAC_CONS')$$);
SELECT cron.schedule('sanctions-sync-eu',        '15 6 * * *', $$SELECT public.fn_trigger_sanctions_sync('EU')$$);
SELECT cron.schedule('sanctions-sync-uk',        '20 6 * * *', $$SELECT public.fn_trigger_sanctions_sync('UK')$$);
SELECT cron.schedule('sanctions-sync-un',        '25 6 * * *', $$SELECT public.fn_trigger_sanctions_sync('UN')$$);
