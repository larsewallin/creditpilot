-- Migration: Drop legacy/cruft columns surfaced by B0 Phase 1 audit
-- (MINIMAL SCOPE — view-blocked drops deferred to a later paired migration)
--
-- All columns dropped here have been verified to have:
--   1. No readers in supabase/functions/ (agent code grep)
--   2. No dependencies on any view in public schema (pg_get_viewdef check)
-- They are pre-V1-taxonomy or duplicate-column leftovers.
--
-- Three originally-planned drops are DEFERRED to a follow-up migration that
-- updates the dependent views first:
--   - customers.flags (blocked by v_portfolio_overview, v_customers_at_risk)
--   - payment_transactions.paid_on_time (blocked by v_customers_at_risk, v_payment_behaviour)
--   - ar_aging_snapshots.dso_days (blocked by v_ar_aging_current, v_ar_aging_portfolio)
--
-- See CreditPilot_B0_Rebuild_Plan.md → "Views audit" section for details.

-- invoices: drop three legacy duplicate columns.
-- - amount (numeric default 0): duplicate of invoice_amount, never populated
-- - paid_amount (numeric default 0): duplicate of amount_paid, never populated
-- - dunning_level (integer): duplicate of dunning_stage, parallel encoding never reconciled
ALTER TABLE public.invoices
  DROP COLUMN IF EXISTS amount,
  DROP COLUMN IF EXISTS paid_amount,
  DROP COLUMN IF EXISTS dunning_level;

-- payment_transactions: drop the unused legacy `amount` column.
-- - amount (numeric default 0): duplicate of amount_paid, never populated, no readers
-- NOTE: paid_on_time and its index idx_pmttxn_on_time are NOT dropped here —
-- v_customers_at_risk and v_payment_behaviour still reference paid_on_time.
-- Deferred to a follow-up migration that updates those views first.
ALTER TABLE public.payment_transactions
  DROP COLUMN IF EXISTS amount;
