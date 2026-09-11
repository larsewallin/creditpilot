-- B0 Phase 1d: drop invoices.next_dunning_date (cruft: 0/160 populated, no readers).
-- Rewrite v_overdue_invoices (only passthrough reference) to remove it. Keep claimable.
-- Decision date: 2026-06-05. Verified via dry-run: v_overdue_invoices returns 37 rows
-- (pre_petition correctly excluded post-task#1), column dropped clean. claimable kept
-- (meaningful: maps to the 10 pre_petition invoices; see Data Contract).

BEGIN;

DROP VIEW v_overdue_invoices;
CREATE VIEW v_overdue_invoices AS
 SELECT c.company_name,
    c.ticker,
    c.scenario,
    c.account_manager,
    i.invoice_number,
    i.invoice_amount,
    i.amount_paid,
    i.amount_outstanding,
    i.invoice_date,
    i.due_date,
    i.days_overdue,
    i.status,
    i.dunning_stage,
    i.escalated_to_collections,
    i.claimable,
        CASE
            WHEN i.days_overdue >= 90 THEN 'CRITICAL'::text
            WHEN i.days_overdue >= 60 THEN 'SEVERE'::text
            WHEN i.days_overdue >= 30 THEN 'WARNING'::text
            ELSE 'MONITOR'::text
        END AS risk_tier
   FROM invoices i
     JOIN customers c ON c.id = i.customer_id
  WHERE i.days_overdue > 0
  ORDER BY i.days_overdue DESC;

ALTER TABLE invoices DROP COLUMN next_dunning_date;

COMMIT;
