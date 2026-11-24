-- 20261124000000_demo_as_of_date.sql
-- One "today" for the demo (review 2026-11-23).
--
-- The demo is rebuilt for a calendar day (04:00 New York, or Reset Demo), and its agents,
-- alerts and proposals describe that day. The views aged invoices and windowed payments
-- with CURRENT_DATE, the database's UTC date, so every evening from 19:00 New York to the
-- next rebuild the pages aged everything a day early: a customer that pays on time showed
-- overdue invoices, buckets disagreed with the alerts and the limit proposals.
--
-- private.app_today() is the date pages should age against: on the public demo, the day the
-- demo was built (instance_settings.demo_as_of, written by the rebuild); everywhere else,
-- CURRENT_DATE, as before. Every public view that used CURRENT_DATE is recreated from its
-- live definition with private.app_today() instead (same columns, same options, same grants).
-- v_app_today exposes the date to the screens, which aged with the visitor's own clock.
-- migrate.sh wraps this in a transaction; no BEGIN/COMMIT here.

ALTER TABLE public.instance_settings ADD COLUMN demo_as_of date;

CREATE OR REPLACE FUNCTION private.app_today()
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN COALESCE((SELECT public_demo FROM public.instance_settings WHERE id), false)
              THEN COALESCE((SELECT demo_as_of FROM public.instance_settings WHERE id), CURRENT_DATE)
              ELSE CURRENT_DATE END;
$$;
REVOKE ALL ON FUNCTION private.app_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.app_today() TO anon, authenticated, service_role;

DO $$
DECLARE
  v record;
  def text;
  opts text;
BEGIN
  FOR v IN
    SELECT c.oid, c.relname, c.reloptions
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND pg_get_viewdef(c.oid) ILIKE '%CURRENT_DATE%'
  LOOP
    def := replace(pg_get_viewdef(v.oid), 'CURRENT_DATE', 'private.app_today()');
    opts := array_to_string(v.reloptions, ', ');
    EXECUTE format('CREATE OR REPLACE VIEW public.%I %s AS %s',
                   v.relname, CASE WHEN opts IS NULL OR opts = '' THEN '' ELSE 'WITH (' || opts || ')' END, def);
    RAISE NOTICE 'view % now ages against private.app_today()', v.relname;
  END LOOP;
END $$;

-- The date for the screens: signed-out visitors of the public demo and CreditPilot users only
-- (the same people who can read the demo's invoices).
CREATE VIEW public.v_app_today WITH (security_invoker = true) AS
SELECT private.app_today() AS today
WHERE (current_user = 'anon' AND private.is_public_demo()) OR private.is_app_user();
GRANT SELECT ON public.v_app_today TO anon, authenticated, service_role;
