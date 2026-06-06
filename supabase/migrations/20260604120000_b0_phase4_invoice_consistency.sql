-- B0 Phase 4 — Invoice consistency + exposure/snapshot re-derivation
-- Data-only migration. Verified via BEGIN/ROLLBACK dry-run (V1 still_mismatched=0,
-- V4 per-customer exposure=snapshot, 0 mismatches). Harness must pass 8/8.
--
-- See backlog F1 (fn_refresh_ar_aging missing pre_petition guard on mid-range
-- buckets — worked around here by zeroing days_overdue on pre_petition) and
-- F2 (frozen demo aging time — not re-anchored here; deferred to task #2 / D0c).

BEGIN;

-- Reclassify legacy 'open' status → 'current' (all days_overdue=0, future due dates)
UPDATE invoices SET status = 'current' WHERE status = 'open';

-- 4a. Invoice amount consistency: stored outstanding_amount agrees with generated
UPDATE invoices SET amount_paid = invoice_amount, outstanding_amount = 0
WHERE status = 'paid';
UPDATE invoices SET outstanding_amount = invoice_amount
WHERE status IN ('current','overdue','pre_petition','disputed');
UPDATE invoices SET outstanding_amount = 0
WHERE status = 'written_off';

-- 4a-addendum: pre_petition invoices exit normal aging (bankruptcy freezes
-- collections aging). Keeps them out of the 1-30/31-60/61-90 buckets, which
-- lack a status guard, so they count ONLY in pre_petition_amount. Works around
-- the latent function bug logged as backlog F1.
UPDATE invoices SET days_overdue = 0 WHERE status = 'pre_petition';

-- 4b. Re-derive current_exposure for every customer
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM customers LOOP
    PERFORM fn_recalculate_exposure(v_id);
  END LOOP;
END $$;

-- 4c. Rebuild AR aging snapshots from corrected invoices, at existing latest date
SELECT fn_refresh_all_ar_aging((SELECT max(snapshot_date) FROM ar_aging_snapshots));

COMMIT;
