-- 20261013000000_sanctions_lists.sql
--
-- New Customer Onboarding, Phase 1: local copy of the official sanctions lists
-- (OFAC SDN and non-SDN consolidated, EU FSF, UK Sanctions List, UN
-- Security Council). Filled daily by the sanctions-sync edge function from the
-- official downloads; screening reads only from here. This avoids the
-- OpenSanctions non-commercial licence and per-application downloads.
--
-- sanctions_entries   one row per listed person or entity, with aliases
-- sanctions_names     every name and alias, normalized, trigram-indexed
-- sanctions_list_runs one row per sync attempt per list (audit trail)
-- sanctions_list_status  latest successful load per list; screening refuses
--                     to run if any list is missing or stale (fail closed)
-- fn_sanctions_candidates  trigram pre-filter; final scoring (Jaro-Winkler +
--                     Soundex) happens in the match-sanctions-name skill
-- sanctions_entries_staging + fn_sanctions_swap  a new download is loaded into
--                     staging in chunks, then swapped in ONE transaction, so
--                     screening never sees a half-loaded list. The swap
--                     refuses a file that shrank by more than half.
--
-- Lists are public data, so signed-in credit roles can read them. Writes are
-- service-role only.

CREATE TABLE public.sanctions_entries (
  id            bigserial PRIMARY KEY,
  list          text NOT NULL CHECK (list IN ('OFAC_SDN','OFAC_CONS','EU','UK','UN')),
  list_id       text NOT NULL,
  entry_type    text NOT NULL CHECK (entry_type IN ('entity','person')),
  name          text NOT NULL,
  aliases       text[] NOT NULL DEFAULT '{}',
  country_code  text,
  date_of_birth text,
  programs      text[] NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list, list_id)
);

CREATE TABLE public.sanctions_names (
  entry_id  bigint NOT NULL REFERENCES public.sanctions_entries(id) ON DELETE CASCADE,
  name_norm text NOT NULL
);
CREATE INDEX sanctions_names_entry_idx ON public.sanctions_names (entry_id);
CREATE INDEX sanctions_names_trgm_idx ON public.sanctions_names USING gin (name_norm public.gin_trgm_ops);

CREATE TABLE public.sanctions_list_runs (
  id           bigserial PRIMARY KEY,
  list         text NOT NULL,
  source_url   text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error','skipped')),
  entry_count  integer,
  error        text
);
CREATE INDEX sanctions_list_runs_list_idx ON public.sanctions_list_runs (list, finished_at DESC);

CREATE TABLE public.sanctions_entries_staging (
  run_id        bigint NOT NULL REFERENCES public.sanctions_list_runs(id) ON DELETE CASCADE,
  list          text NOT NULL,
  list_id       text NOT NULL,
  entry_type    text NOT NULL,
  name          text NOT NULL,
  aliases       text[] NOT NULL DEFAULT '{}',
  country_code  text,
  date_of_birth text,
  programs      text[] NOT NULL DEFAULT '{}',
  names_norm    text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX sanctions_entries_staging_run_idx ON public.sanctions_entries_staging (run_id);

CREATE OR REPLACE FUNCTION public.fn_sanctions_swap(p_run_id bigint, p_min_ratio real DEFAULT 0.5)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_list text;
  v_new integer;
  v_old integer;
BEGIN
  SELECT list INTO v_list FROM public.sanctions_list_runs WHERE id = p_run_id;
  IF v_list IS NULL THEN RAISE EXCEPTION 'Unknown sanctions run %', p_run_id; END IF;
  SELECT count(DISTINCT list_id) INTO v_new FROM public.sanctions_entries_staging WHERE run_id = p_run_id;
  SELECT count(*) INTO v_old FROM public.sanctions_entries WHERE list = v_list;
  IF v_new = 0 OR (v_old > 0 AND v_new < v_old * p_min_ratio) THEN
    RAISE EXCEPTION 'Refusing to replace % list: % entries now vs % before', v_list, v_new, v_old;
  END IF;

  DELETE FROM public.sanctions_entries WHERE list = v_list;
  INSERT INTO public.sanctions_entries (list, list_id, entry_type, name, aliases, country_code, date_of_birth, programs)
  SELECT DISTINCT ON (list_id) list, list_id, entry_type, name, aliases, country_code, date_of_birth, programs
  FROM public.sanctions_entries_staging WHERE run_id = p_run_id
  ORDER BY list_id;
  INSERT INTO public.sanctions_names (entry_id, name_norm)
  SELECT DISTINCT e.id, n.name_norm
  FROM public.sanctions_entries_staging s
  JOIN public.sanctions_entries e ON e.list = s.list AND e.list_id = s.list_id
  CROSS JOIN LATERAL unnest(s.names_norm) AS n(name_norm)
  WHERE s.run_id = p_run_id AND n.name_norm <> '';
  DELETE FROM public.sanctions_entries_staging WHERE run_id = p_run_id;

  UPDATE public.sanctions_list_runs SET status = 'ok', finished_at = now(), entry_count = v_new WHERE id = p_run_id;
  RETURN v_new;
END $$;

CREATE VIEW public.sanctions_list_status WITH (security_invoker = true) AS
SELECT list,
       max(finished_at) FILTER (WHERE status = 'ok') AS last_success_at,
       (array_agg(entry_count ORDER BY finished_at DESC) FILTER (WHERE status = 'ok'))[1] AS entry_count,
       (array_agg(error ORDER BY finished_at DESC NULLS LAST) FILTER (WHERE status = 'error'))[1] AS last_error,
       max(finished_at) FILTER (WHERE status = 'error') AS last_error_at
FROM public.sanctions_list_runs
GROUP BY list;

CREATE OR REPLACE FUNCTION public.fn_sanctions_candidates(p_names text[], p_min_similarity real DEFAULT 0.3)
RETURNS TABLE(list text, list_id text, entry_type text, name text, aliases text[], country_code text, date_of_birth text)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM set_config('pg_trgm.similarity_threshold', p_min_similarity::text, true);
  PERFORM set_config('pg_trgm.word_similarity_threshold', p_min_similarity::text, true);
  RETURN QUERY
  SELECT DISTINCT e.list, e.list_id, e.entry_type, e.name, e.aliases, e.country_code, e.date_of_birth
  FROM unnest(p_names) AS q(name)
  JOIN public.sanctions_names n ON (n.name_norm % lower(q.name) OR lower(q.name) <% n.name_norm)
  JOIN public.sanctions_entries e ON e.id = n.entry_id
  LIMIT 500;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sanctions_entries','sanctions_names','sanctions_list_runs','sanctions_entries_staging'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY service_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY credit_roles_read ON public.%I FOR SELECT TO authenticated USING (public.current_app_role() IN (''admin'',''credit_manager'',''credit_analyst''))', t);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_sanctions_swap(bigint, real) FROM PUBLIC, anon, authenticated;
