-- 20261011000000_app_users_and_authenticated_read.sql
--
-- Phase 0 of New Customer Onboarding (claude/CreditPilot_Onboarding_Build_Plan.md §3):
-- sign-in with sign-up disabled. Accounts are created by an admin only
-- (scripts/create-demo-users.mjs or the Supabase dashboard), never by visitors.
--
-- 1. app_users: one row per person who can sign in, with their role.
--    Roles are about what someone does; approval limits come later from the
--    approval matrix in Settings, not from the role name.
--    No write policies: rows are written only with the service role.
--
-- 2. current_app_role(): the signed-in user's role (null when signed out or
--    deactivated). For RLS and edge functions.
--
-- 3. Signed-in users must see everything a signed-out visitor sees today.
--    supabase-js sends the user's JWT once signed in, so queries run as the
--    `authenticated` role, not `anon`. Most tables already have an
--    `auth_select` policy, but credit_events and customer_identifiers are
--    anon-only (found 2026-10-11), so a signed-in user would see an empty
--    events feed. The DO block below adds an authenticated read policy to
--    every table that anon can read, based on the live pg_policies (not the
--    migration files), so it also covers any drift. It is read-only: no
--    write access is added for anyone.

CREATE TABLE public.app_users (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'credit_manager', 'credit_analyst', 'sales', 'viewer')),
  is_demo      boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_users_read ON public.app_users
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.app_users WHERE user_id = auth.uid() AND active;
$$;

REVOKE ALL ON FUNCTION public.current_app_role() FROM public;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT p.schemaname, p.tablename
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.cmd IN ('SELECT', 'ALL')
      AND p.tablename <> 'app_users'
      AND ('anon' = ANY (p.roles) OR p.qual ILIKE '%''anon''%')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies q
        WHERE q.schemaname = p.schemaname AND q.tablename = p.tablename
          AND q.policyname = 'authenticated_read'
      )
  LOOP
    EXECUTE format('CREATE POLICY authenticated_read ON %I.%I FOR SELECT TO authenticated USING (true)', t.schemaname, t.tablename);
    RAISE NOTICE 'authenticated_read added on %.%', t.schemaname, t.tablename;
  END LOOP;
END $$;
