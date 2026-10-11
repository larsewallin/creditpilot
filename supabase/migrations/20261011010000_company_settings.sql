-- 20261011010000_company_settings.sql
--
-- Phase 0 of New Customer Onboarding: company-level policy settings.
-- One row per key (onboarding.template, onboarding.screening, onboarding.limits,
-- onboarding.sources, onboarding.approval). A row holds only the company's
-- overrides; code defaults (ONBOARDING_DEFAULTS) fill the rest.
--
-- Signed-in users can read. Nobody writes from the browser: changes go through
-- the `settings` edge function, which checks role and validates the value.
-- Every change is also kept in company_settings_history (credit policy needs
-- an audit trail: who changed which limit rule, and when).

CREATE TABLE public.company_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.company_settings_history (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  changed_by  uuid REFERENCES auth.users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX company_settings_history_key_idx ON public.company_settings_history (key, changed_at DESC);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read ON public.company_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY authenticated_read ON public.company_settings_history
  FOR SELECT TO authenticated USING (true);

CREATE POLICY service_all ON public.company_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_all ON public.company_settings_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
