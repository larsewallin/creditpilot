-- Migration: Create customer_identifiers table (B0 Phase 3)
-- External identifiers (DUNS, ticker, CIK, LEI, internal_customer_code) for
-- customer lookup. Single source of truth — replaces denormalized columns
-- on customers (sec_cik, ticker) which will be dropped in a later migration
-- after Phase 4 data migration completes and callers are updated.
-- See CreditPilot_Customer_Identifier_Strategy.md for full design.

CREATE TABLE IF NOT EXISTS public.customer_identifiers (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  id_type      text NOT NULL,
  id_value     text NOT NULL,
  is_primary   boolean NOT NULL DEFAULT false,
  source       text NOT NULL,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_identifiers_id_type_check
    CHECK (id_type IN ('duns', 'ticker', 'cik', 'lei', 'internal_customer_code')),
  CONSTRAINT customer_identifiers_source_check
    CHECK (source IN ('manual', 'edgar_verified', 'customer_supplied', 'duns_lookup'))
);

-- One identifier value cannot point to two customers (globally unique per type).
-- A typo'd DUNS that matches a real customer fails this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS customer_identifiers_type_value_uq
  ON public.customer_identifiers (id_type, id_value);

-- A customer can have at most one primary identifier of each type.
-- (A customer can have multiple non-primary identifiers — e.g. legacy DUNS
-- + current DUNS — but only one is marked is_primary.)
CREATE UNIQUE INDEX IF NOT EXISTS customer_identifiers_primary_uq
  ON public.customer_identifiers (customer_id, id_type)
  WHERE is_primary = true;

-- Fast reverse lookup by customer.
CREATE INDEX IF NOT EXISTS customer_identifiers_customer_idx
  ON public.customer_identifiers (customer_id);

-- Match the updated_at maintenance pattern used elsewhere
-- (fn_updated_at trigger exists from earlier migrations).
DROP TRIGGER IF EXISTS trg_customer_identifiers_upd ON public.customer_identifiers;
CREATE TRIGGER trg_customer_identifiers_upd
  BEFORE UPDATE ON public.customer_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();

-- RLS — same anon-can-read / service-role-full pattern as other tables.
ALTER TABLE public.customer_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select_customer_identifiers
  ON public.customer_identifiers FOR SELECT TO anon USING (true);

CREATE POLICY service_all_customer_identifiers
  ON public.customer_identifiers FOR ALL TO service_role USING (true);

GRANT SELECT ON public.customer_identifiers TO anon;
GRANT ALL ON public.customer_identifiers TO service_role;

COMMENT ON TABLE public.customer_identifiers IS
  'External identifiers (DUNS, ticker, CIK, LEI, internal_customer_code) for customer lookup. Single source of truth — see CreditPilot_Customer_Identifier_Strategy.md.';
