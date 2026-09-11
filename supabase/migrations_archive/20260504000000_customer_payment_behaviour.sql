-- Add payment behaviour columns to customers table
-- Written by AR aging agent after every run
-- Read by CIA agent for assessCompositeRisk and calculateCreditLimitProposal

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_on_time_rate numeric,
  ADD COLUMN IF NOT EXISTS payment_avg_days_early_late numeric,
  ADD COLUMN IF NOT EXISTS payment_trend text,
  ADD COLUMN IF NOT EXISTS payment_health text,
  ADD COLUMN IF NOT EXISTS payment_behaviour_updated_at timestamptz;

-- Constraints
ALTER TABLE public.customers
  ADD CONSTRAINT customers_payment_trend_check
  CHECK (payment_trend IN ('improving', 'stable', 'deteriorating', 'insufficient_data') OR payment_trend IS NULL);

ALTER TABLE public.customers
  ADD CONSTRAINT customers_payment_health_check
  CHECK (payment_health IN ('healthy', 'watch', 'at_risk', 'unknown') OR payment_health IS NULL);
