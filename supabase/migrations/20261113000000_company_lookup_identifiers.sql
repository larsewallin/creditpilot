-- 20261113000000_company_lookup_identifiers.sql
--
-- Company Lookup connector: customer_identifiers can hold the company's ID across
-- CreditPilot, Company Lookup and Keen (company_id: gb:00445790, us:sec-0000320193,
-- lei:…, built from an official number) and its national registration number.
-- New source value company_lookup for identifiers taken from a Company Lookup card.
-- Additive only: both CHECK lists are widened, nothing is removed.

ALTER TABLE public.customer_identifiers DROP CONSTRAINT IF EXISTS customer_identifiers_id_type_check;
ALTER TABLE public.customer_identifiers ADD CONSTRAINT customer_identifiers_id_type_check
  CHECK (id_type IN ('duns', 'ticker', 'cik', 'lei', 'internal_customer_code', 'tax_id', 'company_id', 'registration_no'));

ALTER TABLE public.customer_identifiers DROP CONSTRAINT IF EXISTS customer_identifiers_source_check;
ALTER TABLE public.customer_identifiers ADD CONSTRAINT customer_identifiers_source_check
  CHECK (source IN ('manual', 'edgar_verified', 'customer_supplied', 'duns_lookup', 'company_lookup'));
