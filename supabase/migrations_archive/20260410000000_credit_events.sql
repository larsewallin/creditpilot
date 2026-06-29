-- Migration: credit_events table and customer enhancements
-- Part of CreditPilot v1 architecture

-- Add credit rating and company type to customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS company_type text DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS credit_rating_score integer,
  ADD COLUMN IF NOT EXISTS credit_rating_raw text,
  ADD COLUMN IF NOT EXISTS credit_rating_source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_company_type_check') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_company_type_check
      CHECK (company_type IN ('public','private','sme'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_credit_rating_score_check') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_credit_rating_score_check
      CHECK (credit_rating_score BETWEEN 0 AND 100);
  END IF;
END $$;

-- credit_events: unified event bus for all agents
CREATE TABLE IF NOT EXISTS public.credit_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope               text NOT NULL DEFAULT 'customer',
  customer_id         uuid REFERENCES public.customers(id),
  customer_ids        uuid[],
  event_type          text NOT NULL,
  source_agent        text NOT NULL,
  severity            text NOT NULL,
  signal_type         text,
  title               text NOT NULL,
  description         text,
  payload             jsonb NOT NULL DEFAULT '{}',
  previous_value      numeric,
  new_value           numeric,
  value_type          text,
  credit_rating_score integer,
  credit_rating_raw   text,
  credit_rating_source text,
  action_required     boolean DEFAULT false,
  action_type         text,
  action_status       text DEFAULT 'none',
  reviewed_by         text,
  reviewed_at         timestamptz,
  review_note         text,
  archived_at         timestamptz,
  cia_processed       boolean DEFAULT false,
  cia_processed_at    timestamptz,
  cia_decision        text,
  run_id              uuid REFERENCES public.agent_runs(id),
  parent_event_id     uuid REFERENCES public.credit_events(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT credit_events_scope_check CHECK (scope IN ('customer','industry','country','macro')),
  CONSTRAINT credit_events_severity_check CHECK (severity IN ('critical','high','medium','low','info')),
  CONSTRAINT credit_events_action_status_check CHECK (action_status IN ('none','pending','auto_approved','human_approved','human_rejected','executed')),
  CONSTRAINT credit_events_rating_score_check CHECK (credit_rating_score BETWEEN 0 AND 100)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_credit_events_customer ON public.credit_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_events_type ON public.credit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_credit_events_severity ON public.credit_events(severity);
CREATE INDEX IF NOT EXISTS idx_credit_events_unprocessed ON public.credit_events(cia_processed) WHERE cia_processed = false;
CREATE INDEX IF NOT EXISTS idx_credit_events_active ON public.credit_events(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_events_created ON public.credit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_events_scope ON public.credit_events(scope);

-- RLS
ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select_credit_events ON public.credit_events FOR SELECT TO anon USING (true);
CREATE POLICY anon_insert_credit_events ON public.credit_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_credit_events ON public.credit_events FOR UPDATE TO anon USING (true);
CREATE POLICY service_all_credit_events ON public.credit_events FOR ALL TO service_role USING (true);

GRANT SELECT, INSERT, UPDATE ON public.credit_events TO anon;
GRANT ALL ON public.credit_events TO service_role;
