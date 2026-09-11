-- Adds new customer profile fields designed in docs/CUSTOMER_PROFILE_FIELDS.md:
-- structured company/address details not previously captured, plus a new
-- identifier type (tax_id) for customer_identifiers. Additive only -- does
-- not touch or deprecate customers.headquarters (that migration is deferred
-- to the "Add Customer" feature session, per the design doc).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS international_business_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS trade_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS naics_sic_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postcode text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS invoicing_currency text DEFAULT 'USD';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_manager text;

ALTER TABLE customer_identifiers DROP CONSTRAINT IF EXISTS customer_identifiers_id_type_check;
ALTER TABLE customer_identifiers ADD CONSTRAINT customer_identifiers_id_type_check
  CHECK (id_type IN ('duns', 'ticker', 'cik', 'lei', 'internal_customer_code', 'tax_id'));
