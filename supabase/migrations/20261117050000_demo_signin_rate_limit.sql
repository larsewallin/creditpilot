-- 20261117050000_demo_signin_rate_limit.sql
-- Pre-launch audit 2026-11-17: the "Try it as" sign-in (demo-signin) had no rate limit.
-- One counter per address per day; demo-signin refuses above 30. Service role only.

CREATE TABLE IF NOT EXISTS public.demo_signin_counts (
  ip_address text NOT NULL,
  day        date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  count      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_address, day)
);
-- RLS, the gates and no direct writes come from the close_new_public_tables event trigger;
-- repeated here so the migration stands on its own.
ALTER TABLE public.demo_signin_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_signin_counts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_increment_demo_signin_count(p_ip_address text)
RETURNS integer
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO public.demo_signin_counts AS c (ip_address, day, count)
  VALUES (p_ip_address, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (ip_address, day) DO UPDATE SET count = c.count + 1
  RETURNING count;
$$;
REVOKE ALL ON FUNCTION public.fn_increment_demo_signin_count(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_increment_demo_signin_count(text) TO service_role;
