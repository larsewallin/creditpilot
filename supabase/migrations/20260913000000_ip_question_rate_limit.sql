-- Server-side rate limit for cia-agent's question mode. Previously the only
-- protection was a client-side sessionStorage counter (CIA.tsx), trivially
-- bypassed by a new tab, incognito, or calling the endpoint directly -- and
-- the demo runs on real Anthropic API tokens, which cost money per question.
--
-- Composite primary key on (ip_address, question_date) -- not a surrogate id
-- plus a separate UNIQUE constraint -- matching the existing precedent in this
-- schema (agent_processed_events uses a composite PK the same way for a
-- natural-key, nothing-else-references-this-row table).
--
-- RLS is enabled with zero policies, deliberately NOT copying
-- agent_processed_events' own setup (that table has RLS disabled entirely,
-- which would leave a rate-limit table open to anon tampering via PostgREST).
-- cia-agent uses the service-role client, which bypasses RLS regardless, so
-- this only closes off anon read/write without touching the real write path.

CREATE TABLE public.ip_question_counts (
  ip_address     text NOT NULL,
  question_date  date NOT NULL,
  question_count integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_address, question_date)
);

ALTER TABLE public.ip_question_counts ENABLE ROW LEVEL SECURITY;

-- Atomic check-and-increment: a single upsert statement avoids the
-- read-then-write race a client-side upsert (overwrite, not increment)
-- would have under concurrent requests. Returns the post-increment count.
CREATE OR REPLACE FUNCTION public.fn_increment_ip_question_count(p_ip_address text)
RETURNS integer
LANGUAGE sql
AS $$
  INSERT INTO public.ip_question_counts (ip_address, question_date, question_count)
  VALUES (p_ip_address, CURRENT_DATE, 1)
  ON CONFLICT (ip_address, question_date)
  DO UPDATE SET question_count = ip_question_counts.question_count + 1, updated_at = now()
  RETURNING question_count;
$$;
