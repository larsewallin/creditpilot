-- Migration: Add country_code to customers (B0 Phase 3)
-- Country = country of the customer's company address (ISO 3166-1 alpha-2).
-- The verifiable anchor — backed by postal/registry records.
-- See CreditPilot_Demo_Data_Contract.md for design decision.

-- Default 'US' because:
--   - 48 of 49 customers with known headquarters are US
--   - 10 invented private demo customers default to US by design
--   - Only Liqtech International AS (Denmark) needs correction → Phase 4
-- A brief moment of 'US' on Liqtech before Phase 4 fixes it is acceptable.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'US';

-- Constrain to ISO 3166-1 alpha-2 format (2 uppercase letters).
-- DROP first if it somehow exists from a prior partial run, then add fresh.
-- ALTER TABLE ADD CONSTRAINT does not support IF NOT EXISTS.
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_country_code_format;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_country_code_format
    CHECK (country_code ~ '^[A-Z]{2}$');

COMMENT ON COLUMN public.customers.country_code IS
  'ISO 3166-1 alpha-2 country code. Country of the company''s registered/billing address.';
