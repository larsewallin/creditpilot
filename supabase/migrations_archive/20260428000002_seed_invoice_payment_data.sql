-- Schema-only migration: payment_method enum values + amount column.
-- Data inserts are in 20260428000003 (separate transaction required because
-- PostgreSQL forbids using a newly-added enum value in the same transaction).

-- ── Ensure payment_method enum has the values we need ────────────────────────
DO $$
BEGIN
  ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'wire';
  ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'ach';
  ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'check';
EXCEPTION
  WHEN undefined_object THEN NULL;
END;
$$;

-- ── Ensure payment_transactions.amount exists (remote schema drift) ──────────
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT 0;

-- Data inserts are in 20260428000003_seed_invoice_payment_data.sql

