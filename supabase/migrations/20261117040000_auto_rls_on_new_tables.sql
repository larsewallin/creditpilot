-- 20261117040000_auto_rls_on_new_tables.sql
-- Safety net (Supabase dashboard suggestion, 2026-11-17): every table created later in
-- the public schema -- by a migration or by hand in the dashboard -- starts closed:
-- row-level security on, the two gates of 20261117010000 (signed out: reads only in a
-- public demo; signed in: CreditPilot users only), and no direct writes. A migration
-- then adds the read policies the table needs. tests/security/check-public-access.sh
-- still checks every table on every fresh install.

CREATE OR REPLACE FUNCTION private.close_new_public_tables()
RETURNS event_trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  obj record;
  tbl text;
BEGIN
  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type = 'table' AND schema_name = 'public'
  LOOP
    tbl := split_part(obj.object_identity, '.', 2);
    tbl := trim(both '"' from tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS gate_anon ON public.%I', tbl);
    EXECUTE format('CREATE POLICY gate_anon ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (private.is_public_demo()) WITH CHECK (false)', tbl);
    EXECUTE format('DROP POLICY IF EXISTS gate_authenticated ON public.%I', tbl);
    EXECUTE format('CREATE POLICY gate_authenticated ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.is_app_user()) WITH CHECK (false)', tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', tbl);
    RAISE NOTICE 'closed new table public.%: RLS on, gates added, no direct writes', tbl;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION private.close_new_public_tables() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS close_new_public_tables;
CREATE EVENT TRIGGER close_new_public_tables
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION private.close_new_public_tables();
