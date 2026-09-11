-- Adds infrastructure so demo invoice due_dates never drift stale as real
-- time passes, without needing manual re-anchoring every few weeks (found
-- necessary this session: v_ar_aging_current/portfolio were made live-
-- computed from invoices, which correctly exposed that the underlying demo
-- due_dates were static and had drifted 30 days since the last manual
-- anchor -- the AR Aging page and Credit Events feed showed contradictory
-- data for the same customer as a result).
--
-- demo_days_offset stores each invoice's intended position relative to
-- "today" (e.g. -87 = due 87 days ago, +43 = due in 43 days), captured once
-- from a known-correct, verified-healthy state. fn_reset_demo_invoice_dates()
-- recomputes due_date = CURRENT_DATE + demo_days_offset -- idempotent, can be
-- called any number of times, always produces the same correct relative
-- aging distribution regardless of how much real time has passed. Called
-- automatically from src/lib/initDemo.ts on every demo init (DEMO_MODE-gated).
--
-- pre_petition invoices are deliberately excluded (frozen by design per F1 --
-- bankruptcy freezes normal aging, not date-driven).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS demo_days_offset integer;

CREATE OR REPLACE FUNCTION fn_reset_demo_invoice_dates() RETURNS void
    LANGUAGE plpgsql
    SET search_path = public, extensions
    AS $$
BEGIN
  UPDATE invoices
  SET due_date = CURRENT_DATE + demo_days_offset
  WHERE demo_days_offset IS NOT NULL;
END;
$$;
