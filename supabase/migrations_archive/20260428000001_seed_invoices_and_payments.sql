-- Schema-only migration: add missing enum values + columns.
-- Data inserts are in 20260428000002 (separate transaction, required because
-- PostgreSQL forbids using a newly-added enum value in the same transaction).

-- ── Ensure invoice_status enum has the values we need ────────────────────────
DO $$
BEGIN
  ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'open';
  ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'overdue';
  ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'paid';
EXCEPTION
  WHEN undefined_object THEN NULL;
END;
$$;

-- ── Ensure invoices columns exist (remote schema may predate migrations) ──────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount             numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_overdue       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dunning_level      integer NOT NULL DEFAULT 0;

-- ── Ensure payment_transactions columns exist ─────────────────────────────────
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS days_to_pay     integer,
  ADD COLUMN IF NOT EXISTS days_early_late integer,
  ADD COLUMN IF NOT EXISTS on_time         boolean,
  ADD COLUMN IF NOT EXISTS is_demo         boolean NOT NULL DEFAULT false;

-- Data inserts are in 20260428000002_seed_invoice_payment_data.sql
