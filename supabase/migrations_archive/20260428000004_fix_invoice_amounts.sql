-- Fix invoice and payment amounts that remain $0 after the seed migration.
-- invoice_amount was seeded correctly for open/overdue invoices via 000003,
-- but the is_demo=true historical (paid) invoices may have invoice_amount=0.
-- payment_transactions.amount_paid defaulted to 0 (column was newly added).

-- ── Fix invoice_amount for any demo invoice still at 0 but with outstanding > 0
UPDATE public.invoices
SET invoice_amount = outstanding_amount
WHERE invoice_amount = 0
  AND outstanding_amount > 0
  AND is_demo = true;

-- ── Fix specific historical paid invoices for Triumph Group ───────────────────
UPDATE public.invoices SET invoice_amount = 250000 WHERE invoice_number = 'TGI-2025-0302';
UPDATE public.invoices SET invoice_amount = 420000 WHERE invoice_number = 'TGI-2026-0089';
UPDATE public.invoices SET invoice_amount = 380000 WHERE invoice_number = 'TGI-2026-0103';
UPDATE public.invoices SET invoice_amount = 300000 WHERE invoice_number = 'TGI-2026-0119';

-- ── Fix payment_transactions.amount_paid for demo records still at 0 ──────────
-- Arconic historical payments
UPDATE public.payment_transactions SET amount_paid = 500000
WHERE id = 'd1000001-0000-0000-0000-000000000001';
UPDATE public.payment_transactions SET amount_paid = 350000
WHERE id = 'd1000001-0000-0000-0000-000000000002';

-- Howmet historical payments
UPDATE public.payment_transactions SET amount_paid = 600000
WHERE id = 'd1000002-0000-0000-0000-000000000001';
UPDATE public.payment_transactions SET amount_paid = 450000
WHERE id = 'd1000002-0000-0000-0000-000000000002';
UPDATE public.payment_transactions SET amount_paid = 300000
WHERE id = 'd1000002-0000-0000-0000-000000000003';

-- Precision Castparts historical payments
UPDATE public.payment_transactions SET amount_paid = 800000
WHERE id = 'd1000003-0000-0000-0000-000000000001';
UPDATE public.payment_transactions SET amount_paid = 600000
WHERE id = 'd1000003-0000-0000-0000-000000000002';

-- Triumph Group historical payments
UPDATE public.payment_transactions SET amount_paid = 250000
WHERE id = 'd1000004-0000-0000-0000-000000000001';
