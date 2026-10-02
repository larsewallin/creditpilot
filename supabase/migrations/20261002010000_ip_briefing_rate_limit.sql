-- Server-side rate limit for cia-agent's briefing mode, mirroring
-- 20260913000000_ip_question_rate_limit.sql's pattern exactly for the same
-- reason: this demo runs on real Anthropic API tokens, and the briefing path
-- had zero server-side protection (verify_jwt = false on all functions, the
-- anon key is public in the frontend bundle, so anyone can call cia-agent
-- directly, bypassing the Reset Demo button and client-side checks entirely).
--
-- As of this same date, initDemo.ts's own reset-triggered call passes
-- skip_briefing: true, so routine demo resets no longer hit this limit at
-- all (they skip the Anthropic call entirely -- see cia-agent/index.ts's
-- CIARequest.skip_briefing doc comment). This limit is a backstop for any
-- direct/manual call to briefing mode without that flag, not the main
-- defense against reset abuse -- skip_briefing is.
--
-- Separate counter table from ip_question_counts, deliberately: these are
-- different budgets (full-briefing generations vs question answers) and
-- should not share a shared daily count.

CREATE TABLE IF NOT EXISTS public.ip_reset_counts (
  ip_address   text NOT NULL,
  reset_date   date NOT NULL,
  reset_count  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_address, reset_date)
);

ALTER TABLE public.ip_reset_counts ENABLE ROW LEVEL SECURITY;

-- No policies, same reasoning as ip_question_counts: cia-agent uses the
-- service-role client (bypasses RLS), this just closes anon read/write via
-- PostgREST.

CREATE OR REPLACE FUNCTION public.fn_increment_ip_reset_count(p_ip_address text)
RETURNS integer
LANGUAGE sql
AS $$
  INSERT INTO public.ip_reset_counts (ip_address, reset_date, reset_count)
  VALUES (p_ip_address, CURRENT_DATE, 1)
  ON CONFLICT (ip_address, reset_date)
  DO UPDATE SET reset_count = ip_reset_counts.reset_count + 1, updated_at = now()
  RETURNING reset_count;
$$;
