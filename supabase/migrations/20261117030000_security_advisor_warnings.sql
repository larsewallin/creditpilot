-- 20261117030000_security_advisor_warnings.sql
-- Clears the Supabase Security Advisor warnings of 2026-11-17 (13 of 14; the 14th,
-- leaked-password protection, is an Auth setting, not SQL).

-- 1. function_search_path_mutable: pin the search path of the six functions that had none.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fn_updated_at', 'fn_recalculate_exposure', 'fn_increment_ip_question_count',
                        'naics_to_sector', 'trg_customers_sector_from_naics', 'fn_increment_ip_reset_count')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', f.sig);
  END LOOP;
END $$;

-- 2. extension_in_public: pg_trgm moves to the extensions schema. Its indexes keep
--    working (they point at the operator classes, not the schema), and the one function
--    that uses its operators (fn_sanctions_candidates) already searches public, extensions.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- 3. anon/authenticated_security_definer_function_executable: the three helpers the
--    row-level policies call must stay executable by the reader, so they move out of
--    the API schema instead: in "private" they cannot be called at /rest/v1/rpc/...,
--    while every policy keeps calling them (policies refer to the function itself, not
--    its name).
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

ALTER FUNCTION public.is_public_demo() SET SCHEMA private;
ALTER FUNCTION public.is_app_user() SET SCHEMA private;
ALTER FUNCTION public.current_app_role() SET SCHEMA private;
