-- Same self-healing pattern as invoices.due_date
-- (20260814000000_demo_invoice_date_auto_reanchor.sql): demo
-- payment_transactions dates were static and drifted stale as real time
-- passed. Found via payment-behaviour-agent's first live invocation, which
-- produced zero events across all 58 exposure-holding customers -- every
-- one of them had payment history stopping at 2026-05-09, over 4 months
-- before either 30-day comparison window could reach.
--
-- demo_days_offset stores each row's payment_date position relative to
-- "today" (e.g. -34 = paid 34 days ago), captured once from a known-correct
-- state. fn_reset_demo_payment_dates() recomputes payment_date =
-- CURRENT_DATE + demo_days_offset, and shifts invoice_date/invoice_due_date
-- by the same delta so all three stay internally consistent on every row --
-- idempotent, callable any number of times, always reproduces the same
-- relative payment-timing distribution regardless of how much real time has
-- passed. Wired into demo-actions/index.ts's reset handler alongside the
-- existing fn_reset_demo_invoice_dates call.

ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS demo_days_offset integer;

CREATE OR REPLACE FUNCTION fn_reset_demo_payment_dates() RETURNS void
    LANGUAGE plpgsql
    SET search_path = public, extensions
    AS $$
BEGIN
  UPDATE payment_transactions
  SET invoice_date     = invoice_date     + ((CURRENT_DATE + demo_days_offset) - payment_date),
      invoice_due_date  = invoice_due_date + ((CURRENT_DATE + demo_days_offset) - payment_date),
      payment_date      = CURRENT_DATE + demo_days_offset
  WHERE demo_days_offset IS NOT NULL;
END;
$$;
