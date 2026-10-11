-- 20261011020000_onboarding_prospect_model.sql
--
-- Phase 0 of New Customer Onboarding: the data model for prospects.
--
-- A prospect is a normal row in customers with lifecycle_status = 'prospect'
-- and credit_limit = 0 (CIA already skips customers without a limit). Every
-- existing customer becomes 'active', so nothing changes for the demo.
-- Agents and views are switched to active-only in the next step; until a
-- prospect exists, adding the column changes nothing.
--
-- Access: nothing here is readable by anon. Application data holds personal
-- details of directors and owners, so screening and score tables are
-- limited to admin / credit_manager / credit_analyst. All writes are
-- service-role only (edge functions).

ALTER TABLE public.customers
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active'
  CONSTRAINT customers_lifecycle_status_check
  CHECK (lifecycle_status IN ('prospect', 'active', 'declined', 'inactive'));

CREATE INDEX customers_lifecycle_status_idx ON public.customers (lifecycle_status);

CREATE TABLE public.credit_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  stage             text NOT NULL DEFAULT 'application'
    CHECK (stage IN ('application','completeness','screening','analysis','decision','approval','conditions','active')),
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','incomplete','in_review','decided','withdrawn')),
  answers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_limit_usd bigint,
  requested_terms_days integer,
  submitted_via     text NOT NULL DEFAULT 'staff'
    CHECK (submitted_via IN ('staff','sales','buyer_link')),
  submitted_by      uuid REFERENCES auth.users(id),
  invite_token_hash text,
  completeness      jsonb,
  outcome           jsonb,
  clock_started_at  timestamptz,
  decision_due_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_applications_customer_idx ON public.credit_applications (customer_id);
CREATE INDEX credit_applications_stage_idx ON public.credit_applications (stage, status);

CREATE TABLE public.application_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.credit_applications(id) ON DELETE CASCADE,
  doc_type       text NOT NULL,
  filename       text NOT NULL,
  storage_path   text,
  extraction     jsonb,
  confirmed_by   uuid REFERENCES auth.users(id),
  confirmed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_documents_app_idx ON public.application_documents (application_id);

CREATE TABLE public.screening_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.credit_applications(id) ON DELETE CASCADE,
  result         text NOT NULL DEFAULT 'running' CHECK (result IN ('running','pass','review','fail','error')),
  summary        jsonb,
  lists_version  jsonb,
  run_by         uuid REFERENCES auth.users(id),
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX screening_runs_app_idx ON public.screening_runs (application_id);

CREATE TABLE public.screening_checks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES public.screening_runs(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  subject    text,
  result     text NOT NULL CHECK (result IN ('pass','review','fail','error','skipped')),
  detail     jsonb,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX screening_checks_run_idx ON public.screening_checks (run_id);

CREATE TABLE public.screening_hits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.screening_runs(id) ON DELETE CASCADE,
  subject_name     text NOT NULL,
  subject_role     text,
  list_name        text NOT NULL,
  matched_name     text NOT NULL,
  similarity       numeric NOT NULL CHECK (similarity >= 0 AND similarity <= 1),
  country          text,
  detail           jsonb,
  disposition      text NOT NULL DEFAULT 'open' CHECK (disposition IN ('open','cleared','confirmed')),
  disposition_by   uuid REFERENCES auth.users(id),
  disposition_note text,
  disposed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX screening_hits_run_idx ON public.screening_hits (run_id);

CREATE TABLE public.score_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.credit_applications(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  status         text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','timeout')),
  score          numeric,
  band           text,
  max_credit_recommendation_usd bigint,
  inputs         jsonb,
  detail         jsonb,
  as_of          date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX score_results_app_idx ON public.score_results (application_id);

CREATE TABLE public.underwriting_baseline (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  application_id   uuid REFERENCES public.credit_applications(id),
  approved_limit_usd bigint NOT NULL,
  assumptions      jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_codes     text[] NOT NULL DEFAULT '{}',
  memo             jsonb,
  approved_by      uuid REFERENCES auth.users(id),
  approved_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX underwriting_baseline_customer_idx ON public.underwriting_baseline (customer_id, approved_at DESC);

DO $$
DECLARE
  t text;
  broad text[] := ARRAY['credit_applications','application_documents','underwriting_baseline'];
  restricted text[] := ARRAY['screening_runs','screening_checks','screening_hits','score_results'];
BEGIN
  FOREACH t IN ARRAY broad || restricted LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY service_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
  FOREACH t IN ARRAY broad LOOP
    EXECUTE format('CREATE POLICY app_user_read ON public.%I FOR SELECT TO authenticated USING (public.current_app_role() IS NOT NULL)', t);
  END LOOP;
  FOREACH t IN ARRAY restricted LOOP
    EXECUTE format('CREATE POLICY credit_roles_read ON public.%I FOR SELECT TO authenticated USING (public.current_app_role() IN (''admin'',''credit_manager'',''credit_analyst''))', t);
  END LOOP;
END $$;
