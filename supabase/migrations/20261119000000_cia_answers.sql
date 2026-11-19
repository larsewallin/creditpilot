-- 20261119000000_cia_answers.sql
-- CIA v2 share links (2026-11-19): every answer cia-agent writes is kept here, so an answer can be
-- opened again from a link (/share/<id>). Only answers the server wrote are stored: a share link
-- never shows text a visitor supplied, other than the question. Service role only (cia-agent);
-- in the public demo the shared page is open, in production it needs a signed-in user.

CREATE TABLE IF NOT EXISTS public.cia_answers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_demo    boolean NOT NULL DEFAULT false,
  question   text NOT NULL,
  answer     jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS cia_answers_created_at_idx ON public.cia_answers (created_at);
-- RLS, the gates and no direct writes come from the close_new_public_tables event trigger;
-- repeated here so the migration stands on its own.
ALTER TABLE public.cia_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cia_answers FROM anon, authenticated;
