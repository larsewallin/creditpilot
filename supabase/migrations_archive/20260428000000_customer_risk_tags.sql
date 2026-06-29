-- Agent-generated risk tags on customers
-- Written by CIA agent after composite risk assessment
-- Separate from customers.flags[] which are manual labels set by credit managers

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS risk_tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS risk_tags_updated_at timestamptz;

-- Seed demo risk tags for Triumph Group and Arconic (our flagged demo customers)
UPDATE public.customers
  SET risk_tags = ARRAY['MULTI_SIGNAL_RISK', 'SEC_ALERT', 'NEGATIVE_NEWS'],
      risk_tags_updated_at = now()
  WHERE ticker = 'TGI';

UPDATE public.customers
  SET risk_tags = ARRAY['HIGH_UTILIZATION', 'NEGATIVE_NEWS'],
      risk_tags_updated_at = now()
  WHERE ticker = 'ARNC';

UPDATE public.customers
  SET risk_tags = ARRAY['GOING_CONCERN'],
      risk_tags_updated_at = now()
  WHERE ticker = 'HLGN';
