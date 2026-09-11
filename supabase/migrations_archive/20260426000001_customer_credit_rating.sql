-- Migration: add credit rating columns to customers table
-- Stores the authoritative normalised credit score (0-100) per customer,
-- plus previous score for downgrade detection via detect-rating-change skill.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS credit_rating_score          numeric,
  ADD COLUMN IF NOT EXISTS credit_rating_previous_score numeric,
  ADD COLUMN IF NOT EXISTS credit_rating_source         text,
  ADD COLUMN IF NOT EXISTS credit_rating_updated_at     timestamptz;

-- Scores must be in the 0-100 normalised range if provided
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_credit_rating_score_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_credit_rating_score_check
  CHECK (credit_rating_score IS NULL OR credit_rating_score BETWEEN 0 AND 100);

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_credit_rating_previous_score_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_credit_rating_previous_score_check
  CHECK (credit_rating_previous_score IS NULL OR credit_rating_previous_score BETWEEN 0 AND 100);
