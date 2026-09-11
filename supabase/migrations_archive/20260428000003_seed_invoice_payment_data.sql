-- Seed realistic invoice and payment data for key demo customers.
-- Requires 20260428000001 (invoice_status enum + invoice columns) and
-- 20260428000002 (payment_method enum + payment_transactions.amount column)
-- to have run first in separate transactions.
--
-- Customer IDs (fixed UUIDs from initial scaffold seed):
--   c0000001-0000-0000-0000-000000000029  Arconic Corporation   ($3M limit, 91.7% util target)
--   c0000001-0000-0000-0000-000000000008  Howmet Aerospace      ($4.5M limit, 71.1% util target)
--   c0000001-0000-0000-0000-000000000005  Precision Castparts   ($5M limit, 76% util target)
--   c0000001-0000-0000-0000-000000000021  Triumph Group         ($2M limit, overdue concern)
--   c0000001-0000-0000-0000-000000000049  Heliogen Inc          ($1M limit, going concern)
-- Reference date: 2026-04-28

-- ── Clear existing rows for these customers ───────────────────────────────────

DELETE FROM public.payment_transactions
WHERE customer_id IN (
  'c0000001-0000-0000-0000-000000000029',
  'c0000001-0000-0000-0000-000000000008',
  'c0000001-0000-0000-0000-000000000005',
  'c0000001-0000-0000-0000-000000000021',
  'c0000001-0000-0000-0000-000000000049'
);

DELETE FROM public.invoices
WHERE customer_id IN (
  'c0000001-0000-0000-0000-000000000029',
  'c0000001-0000-0000-0000-000000000008',
  'c0000001-0000-0000-0000-000000000005',
  'c0000001-0000-0000-0000-000000000021',
  'c0000001-0000-0000-0000-000000000049'
);

-- ── Arconic Corporation — $3M limit, target ~$2.75M outstanding (91.7%) ─────
-- Mix of 31-60 and 61-90 day buckets matching credit_events description

INSERT INTO public.invoices (id, customer_id, invoice_number, invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, days_overdue, status, dunning_level, is_demo)
VALUES
  -- 61-90 bucket: $850K, 72 days overdue
  ('b1000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000029',
   'ARC-2026-0112', 850000, 0, 850000, '2026-01-16', '2026-02-15', 72, 'overdue', 2, true),
  -- 31-60 bucket: $750K, 45 days overdue
  ('b1000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000029',
   'ARC-2026-0142', 750000, 0, 750000, '2026-02-12', '2026-03-14', 45, 'overdue', 1, true),
  -- 31-60 bucket: $650K, 38 days overdue
  ('b1000001-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000029',
   'ARC-2026-0158', 650000, 0, 650000, '2026-02-19', '2026-03-21', 38, 'overdue', 1, true),
  -- Current: $500K, due today
  ('b1000001-0000-0000-0000-000000000004', 'c0000001-0000-0000-0000-000000000029',
   'ARC-2026-0198', 500000, 0, 500000, '2026-03-29', '2026-04-28', 0, 'open', 0, true);
-- Total outstanding: $2,750,000 = 91.7% of $3M ✓

-- ── Howmet Aerospace — $4.5M limit, target ~$3.2M outstanding (71.1%) ───────
-- Mix of current and 1-30 day overdue; declining payment rate per credit event

INSERT INTO public.invoices (id, customer_id, invoice_number, invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, days_overdue, status, dunning_level, is_demo)
VALUES
  -- 1-30 bucket: $1.2M, 25 days overdue
  ('b1000002-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000008',
   'HWM-2026-0234', 1200000, 0, 1200000, '2026-03-04', '2026-04-03', 25, 'overdue', 1, true),
  -- 1-30 bucket: $750K, 15 days overdue
  ('b1000002-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000008',
   'HWM-2026-0251', 750000, 0, 750000, '2026-03-14', '2026-04-13', 15, 'overdue', 1, true),
  -- Current: $900K, 5 days remaining
  ('b1000002-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000008',
   'HWM-2026-0270', 900000, 0, 900000, '2026-03-24', '2026-04-23', 0, 'open', 0, true),
  -- Current: $350K, 10 days remaining
  ('b1000002-0000-0000-0000-000000000004', 'c0000001-0000-0000-0000-000000000008',
   'HWM-2026-0281', 350000, 0, 350000, '2026-03-29', '2026-05-03', 0, 'open', 0, true);
-- Total outstanding: $3,200,000 = 71.1% of $4.5M ✓

-- ── Precision Castparts — $5M limit, target ~$3.8M outstanding (76%) ────────

INSERT INTO public.invoices (id, customer_id, invoice_number, invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, days_overdue, status, dunning_level, is_demo)
VALUES
  -- Current: $1.5M
  ('b1000003-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000005',
   'PCC-2026-0187', 1500000, 0, 1500000, '2026-03-15', '2026-04-14', 0, 'open', 0, true),
  -- 1-30 bucket: $1.2M, 22 days overdue
  ('b1000003-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000005',
   'PCC-2026-0162', 1200000, 0, 1200000, '2026-03-07', '2026-04-06', 22, 'overdue', 1, true),
  -- Current: $700K
  ('b1000003-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000005',
   'PCC-2026-0201', 700000, 0, 700000, '2026-03-22', '2026-04-21', 0, 'open', 0, true),
  -- 1-30 bucket: $400K, 10 days overdue
  ('b1000003-0000-0000-0000-000000000004', 'c0000001-0000-0000-0000-000000000005',
   'PCC-2026-0148', 400000, 0, 400000, '2026-03-19', '2026-04-18', 10, 'overdue', 1, true);
-- Total outstanding: $3,800,000 = 76% of $5M ✓

-- ── Triumph Group — $2M limit, multi-signal risk, 61-90 day concern ─────────

INSERT INTO public.invoices (id, customer_id, invoice_number, invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, days_overdue, status, dunning_level, is_demo)
VALUES
  -- 61-90 bucket: $420K, 68 days overdue (covenant waiver concern)
  ('b1000004-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000021',
   'TGI-2026-0089', 420000, 0, 420000, '2026-01-20', '2026-02-19', 68, 'overdue', 2, true),
  -- 31-60 bucket: $380K, 35 days overdue
  ('b1000004-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000021',
   'TGI-2026-0103', 380000, 0, 380000, '2026-02-22', '2026-03-24', 35, 'overdue', 1, true),
  -- Current: $300K
  ('b1000004-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000021',
   'TGI-2026-0119', 300000, 0, 300000, '2026-03-15', '2026-04-14', 0, 'open', 0, true);
-- Total outstanding: $1,100,000 = 55% of $2M

-- ── Heliogen Inc — $1M limit, going concern, minimal AR ─────────────────────

INSERT INTO public.invoices (id, customer_id, invoice_number, invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, days_overdue, status, dunning_level, is_demo)
VALUES
  -- Current: $180K
  ('b1000005-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000049',
   'HLGN-2026-0041', 180000, 0, 180000, '2026-03-29', '2026-04-28', 0, 'open', 0, true);
-- Total outstanding: $180,000 = 18% of $1M

-- ── Historical paid invoices (basis for payment_transactions) ───────────────

INSERT INTO public.invoices (id, customer_id, invoice_number, invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, days_overdue, status, dunning_level, is_demo)
VALUES
  -- Arconic paid (historical)
  ('b1000001-0000-0000-0000-000000000010', 'c0000001-0000-0000-0000-000000000029',
   'ARC-2025-0388', 500000, 500000, 0, '2025-10-15', '2025-11-14', 0, 'paid', 0, true),
  ('b1000001-0000-0000-0000-000000000011', 'c0000001-0000-0000-0000-000000000029',
   'ARC-2025-0412', 350000, 350000, 0, '2025-11-01', '2025-12-01', 0, 'paid', 0, true),
  -- Howmet paid (historical)
  ('b1000002-0000-0000-0000-000000000010', 'c0000001-0000-0000-0000-000000000008',
   'HWM-2025-0501', 600000, 600000, 0, '2025-10-01', '2025-10-31', 0, 'paid', 0, true),
  ('b1000002-0000-0000-0000-000000000011', 'c0000001-0000-0000-0000-000000000008',
   'HWM-2025-0539', 450000, 450000, 0, '2025-11-01', '2025-11-30', 0, 'paid', 0, true),
  ('b1000002-0000-0000-0000-000000000012', 'c0000001-0000-0000-0000-000000000008',
   'HWM-2025-0578', 300000, 300000, 0, '2025-12-01', '2025-12-31', 0, 'paid', 0, true),
  -- Precision Castparts paid (historical)
  ('b1000003-0000-0000-0000-000000000010', 'c0000001-0000-0000-0000-000000000005',
   'PCC-2025-0621', 800000, 800000, 0, '2025-10-15', '2025-11-14', 0, 'paid', 0, true),
  ('b1000003-0000-0000-0000-000000000011', 'c0000001-0000-0000-0000-000000000005',
   'PCC-2025-0658', 600000, 600000, 0, '2025-11-15', '2025-12-15', 0, 'paid', 0, true),
  -- Triumph Group paid (historical)
  ('b1000004-0000-0000-0000-000000000010', 'c0000001-0000-0000-0000-000000000021',
   'TGI-2025-0302', 250000, 250000, 0, '2025-11-01', '2025-12-01', 0, 'paid', 0, true);

-- ── Payment transactions — historical payment behaviour ──────────────────────
-- Arconic: consistently late (reflects 31-90 day overdue pattern)

INSERT INTO public.payment_transactions (id, customer_id, invoice_id, payment_date, amount_paid, payment_method, days_to_pay, days_early_late, on_time, is_demo)
VALUES
  ('d1000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000029',
   'b1000001-0000-0000-0000-000000000010', '2025-11-22', 500000, 'wire', 38, -8, false, true),
  ('d1000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000029',
   'b1000001-0000-0000-0000-000000000011', '2025-12-13', 350000, 'wire', 42, -12, false, true);

-- Howmet: declining on-time rate — good → late → later

INSERT INTO public.payment_transactions (id, customer_id, invoice_id, payment_date, amount_paid, payment_method, days_to_pay, days_early_late, on_time, is_demo)
VALUES
  ('d1000002-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000008',
   'b1000002-0000-0000-0000-000000000010', '2025-10-29', 600000, 'wire', 28, 2, true, true),
  ('d1000002-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000008',
   'b1000002-0000-0000-0000-000000000011', '2025-12-05', 450000, 'wire', 35, -5, false, true),
  ('d1000002-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000008',
   'b1000002-0000-0000-0000-000000000012', '2026-01-15', 300000, 'wire', 45, -15, false, true);

-- Precision Castparts: solid payer despite high utilization

INSERT INTO public.payment_transactions (id, customer_id, invoice_id, payment_date, amount_paid, payment_method, days_to_pay, days_early_late, on_time, is_demo)
VALUES
  ('d1000003-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000005',
   'b1000003-0000-0000-0000-000000000010', '2025-11-12', 800000, 'ach', 28, 2, true, true),
  ('d1000003-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000005',
   'b1000003-0000-0000-0000-000000000011', '2025-12-14', 600000, 'ach', 29, 1, true, true);

-- Triumph Group: history of slow payment, now going overdue

INSERT INTO public.payment_transactions (id, customer_id, invoice_id, payment_date, amount_paid, payment_method, days_to_pay, days_early_late, on_time, is_demo)
VALUES
  ('d1000004-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000021',
   'b1000004-0000-0000-0000-000000000010', '2025-12-18', 250000, 'check', 47, -17, false, true);

-- ── Refresh AR aging snapshots from new invoice data ─────────────────────────
SELECT public.fn_refresh_all_ar_aging(CURRENT_DATE);
