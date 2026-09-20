-- 20260920000000_tighten_anon_write_rls.sql
--
-- Security fix: the public anon key is embedded in the frontend JS bundle
-- (unavoidable for a Supabase client-side app), so any table with an anon
-- INSERT/UPDATE/DELETE policy is writable directly via PostgREST by anyone
-- with devtools, bypassing all application logic (publishEvent, validation,
-- the new demo-actions edge function).
--
-- Traced every anon write against the deployed frontend (src/) before writing
-- this migration:
--   - agent_runs anon INSERT     — unused by the frontend. Dead exposure.
--   - sec_monitoring anon INSERT/UPDATE — frontend only reads this table. Dead exposure.
--   - negative_news "Public insert" (WITH CHECK true, no role check at all) — frontend
--     never inserts, only updates (reviewed flag). Dead exposure, and the most permissive
--     policy in the schema.
--   - pending_actions, customers, credit_actions, credit_events, negative_news UPDATE —
--     real writes, now routed through the demo-actions edge function (service role).
--     See supabase/functions/demo-actions/index.ts.
--   - credit_events anon INSERT — publishEvent.ts (the sole write gateway) already runs
--     under the service role in edge functions; nothing in src/ inserts credit_events
--     directly, so this was also dead exposure.
--
-- After this migration, all 7 tables are anon-read-only. Writes to invoices
-- and agent_messages were already blocked for anon (no anon write policy
-- existed for either) — this migration doesn't change their access, it's
-- just a checkpoint confirming that stays true.

DROP POLICY IF EXISTS anon_insert_agent_runs ON public.agent_runs;
DROP POLICY IF EXISTS anon_insert_sec_monitoring ON public.sec_monitoring;
DROP POLICY IF EXISTS anon_update_sec_monitoring ON public.sec_monitoring;
DROP POLICY IF EXISTS "Public insert" ON public.negative_news;
DROP POLICY IF EXISTS anon_update_negative_news ON public.negative_news;
DROP POLICY IF EXISTS anon_update_pending ON public.pending_actions;
DROP POLICY IF EXISTS anon_update_customers ON public.customers;
DROP POLICY IF EXISTS anon_insert_credit_actions ON public.credit_actions;
DROP POLICY IF EXISTS anon_insert_credit_events ON public.credit_events;
DROP POLICY IF EXISTS anon_update_credit_events ON public.credit_events;
