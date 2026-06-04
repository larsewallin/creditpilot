-- Migration: B0 Phase 4 — easy data migrations (data-only, no agent code changes)
--
-- Four independent data fixes from the B0 audit, each isolated:
--   1. Backfill payment_transactions.on_time from days_early_late
--   2. Set country_code = 'DK' for Liqtech (only non-US customer)
--   3. Migrate customers.sec_cik and customers.ticker into customer_identifiers
--   4. Delete 32 pre-pipeline stale negative_news rows (no content_fingerprint)
--
-- The harder data work (invoice consistency, exposure re-derivation, AR snapshot
-- regen, payment_transactions realism regen, view updates) is deferred to
-- dedicated sessions.
--
-- NOTE: customers.sec_cik and customers.ticker columns are NOT dropped here —
-- sec-monitor-agent still reads customers.sec_cik directly. Drop happens later,
-- after agent code is updated to read from customer_identifiers.

-- =============================================================================
-- Section 1 — Backfill payment_transactions.on_time from days_early_late
-- =============================================================================
-- 185 of 203 rows have on_time IS NULL while days_early_late is populated
-- (range -70 to +3, avg -13). Strict rule: on_time = (days_early_late <= 0).
-- Paid on or before due date counts as on-time. No grace period.
-- See CreditPilot_Demo_Data_Contract.md → payment_transactions section.

UPDATE public.payment_transactions
SET on_time = (days_early_late <= 0)
WHERE on_time IS NULL
  AND days_early_late IS NOT NULL;

-- =============================================================================
-- Section 2 — Set country_code for the one known non-US customer
-- =============================================================================
-- Migration 2 set DEFAULT 'US' for all customers. Only Liqtech (Hobro, Denmark)
-- needs correction. The other 48 customers with US headquarters and the 10
-- invented customers (null headquarters, default to US per design) stay 'US'.

UPDATE public.customers
SET country_code = 'DK'
WHERE company_name = 'Liqtech International AS';

-- =============================================================================
-- Section 3 — Migrate sec_cik and ticker into customer_identifiers
-- =============================================================================
-- Single source of truth. Lookup precedence: DUNS → ticker → cik → lei → name.
-- See CreditPilot_Customer_Identifier_Strategy.md.
--
-- ON CONFLICT DO NOTHING handles re-runs (idempotent) — the unique constraint
-- on (id_type, id_value) catches duplicates.

INSERT INTO public.customer_identifiers (customer_id, id_type, id_value, is_primary, source)
SELECT id, 'cik', sec_cik, true, 'manual'
FROM public.customers
WHERE sec_cik IS NOT NULL AND sec_cik <> ''
ON CONFLICT (id_type, id_value) DO NOTHING;

INSERT INTO public.customer_identifiers (customer_id, id_type, id_value, is_primary, source)
SELECT id, 'ticker', ticker, true, 'manual'
FROM public.customers
WHERE ticker IS NOT NULL AND ticker <> ''
ON CONFLICT (id_type, id_value) DO NOTHING;

-- =============================================================================
-- Section 4 — Delete 32 pre-pipeline stale negative_news rows
-- =============================================================================
-- Pre-pipeline cruft (D0b). 32 rows hand-placed before the news pipeline
-- existed, all with content_fingerprint IS NULL. The 5 pipeline-generated rows
-- (2026-05-25 batch) all have fingerprints and are kept. q4 harness reads the
-- 5 pipeline rows + customer risk_tags; the deleted rows weren't contributing
-- signal.

DELETE FROM public.negative_news
WHERE content_fingerprint IS NULL;

-- =============================================================================
-- Verification queries (run manually after applying; not part of the migration):
--
-- 1. payment_transactions: should show ~0 on_time IS NULL (only rows where
--    days_early_late is also null remain unfixed)
--    SELECT COUNT(*) FILTER (WHERE on_time IS NULL) FROM payment_transactions;
--
-- 2. country_code: 58 US, 1 DK
--    SELECT country_code, COUNT(*) FROM customers GROUP BY country_code;
--
-- 3. customer_identifiers: row per ticker + row per CIK
--    SELECT id_type, COUNT(*) FROM customer_identifiers GROUP BY id_type;
--
-- 4. negative_news: only the 5 pipeline rows remain
--    SELECT COUNT(*), COUNT(content_fingerprint) FROM negative_news;
-- =============================================================================
