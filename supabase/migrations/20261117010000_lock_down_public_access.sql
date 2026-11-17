-- 20261117010000_lock_down_public_access.sql
--
-- Before this migration anyone holding the public (anon) key -- it ships in every
-- browser bundle -- could read every portfolio table and view, and execute every
-- function in the public schema. That is what the hosted demo needs for signed-out
-- visitors, but on anyone's own production install it exposed customers, invoices,
-- payments and events. Also: any signed-in account passed the "authenticated" policies,
-- even one with no CreditPilot access (no active app_users row).
--
-- After it:
--   * instance_settings.public_demo says whether this database is a public demo.
--     It is set to true here only when the demo sample data is present (the hosted
--     demo); a fresh install starts private. scripts/setup-local.sh turns it on for a
--     local demo.
--   * anon (signed out) can read only while public_demo is true, and can never write.
--   * signed-in accounts read only with an active app_users row, and never write
--     directly (every write goes through an edge function with the service role).
--   * every view runs with the reader's rights (security_invoker), so the two rules
--     above also hold through views.
--   * anon and signed-in accounts cannot execute functions, except the helpers the
--     policies themselves call.
-- Behaviour on the hosted demo is unchanged for visitors.

-- 1. The instance flag ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instance_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_demo boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.instance_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.instance_settings (id, public_demo)
SELECT true, EXISTS (SELECT 1 FROM public.customers WHERE id = 'c0000001-0000-0000-0000-000000000038')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_public_demo()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT COALESCE((SELECT public_demo FROM public.instance_settings WHERE id), false); $$;

CREATE OR REPLACE FUNCTION public.is_app_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND active); $$;

-- 2. Tables: RLS on everywhere, two restrictive gates, no direct writes -------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    IF NOT t.relrowsecurity THEN
      -- Keeps today's read behaviour for a table that had no RLS; the gates below
      -- then decide who that applies to.
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t.relname) THEN
        EXECUTE format('CREATE POLICY legacy_read ON public.%I FOR SELECT TO anon, authenticated USING (true)', t.relname);
      END IF;
      RAISE NOTICE 'RLS enabled on public.%', t.relname;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS gate_anon ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY gate_anon ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (public.is_public_demo()) WITH CHECK (false)', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS gate_authenticated ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY gate_authenticated ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_app_user()) WITH CHECK (false)', t.relname);

    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t.relname);
  END LOOP;
END $$;

-- 3. Views run with the reader's rights ---------------------------------------------
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    IF (SELECT relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = v.relname) = 'v' THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
    ELSE
      -- A materialized view has no RLS: signed-out readers lose it outside the demo.
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v.relname);
    END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', v.relname);
  END LOOP;
END $$;

-- 4. Functions: service role only, except the helpers policies call ------------------
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

-- Helpers used inside policies and views are evaluated with the reader's rights.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT DISTINCT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND (
        p.proname IN ('is_public_demo', 'is_app_user', 'current_app_role')
        OR EXISTS (SELECT 1 FROM pg_policies pol WHERE pol.schemaname = 'public'
                   AND (pol.qual ~ ('\m' || p.proname || '\s*\(') OR pol.with_check ~ ('\m' || p.proname || '\s*\(')))
        OR EXISTS (SELECT 1 FROM pg_views vw WHERE vw.schemaname = 'public'
                   AND vw.definition ~ ('\m' || p.proname || '\s*\('))
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.sig);
    RAISE NOTICE 'policy/view helper kept executable: %', f.sig;
  END LOOP;
END $$;

-- 5. Objects created by later migrations start closed too ----------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
