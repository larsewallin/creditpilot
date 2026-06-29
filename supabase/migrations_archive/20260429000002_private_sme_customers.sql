-- Migration: 10 private and SME demo customers with full seed data
-- Reference date: 2026-04-29
-- UUID patterns:
--   customers:        c0000002-0000-0000-0000-00000000000X (1-10)
--   invoices:         b2000XXX-0000-0000-0000-00000000000Y
--   payment_txns:     d2000XXX-0000-0000-0000-000000000001
--   negative_news:    00000020-0000-0000-0000-00000000000X (1-2)
--   credit_events:    e0000002-0000-0000-0000-00000000000X (1-6)
--   pending_actions:  a0000002-0000-0000-0000-00000000000X (1-2)

-- ── Agent run (required for pending_actions FK) ───────────────────────────────

INSERT INTO public.agent_runs (id, run_id, agent_name, status, started_at, completed_at, customers_scanned, conditions_found, actions_taken, summary, triggered_by)
VALUES (
  '0bb08899-6912-0000-0001-000000000000',
  '0bb08899-6912-0000-0001-000000000000',
  'ar_aging_agent',
  'completed',
  now() - interval '4 hours',
  now() - interval '3 hours',
  10, 4, 2,
  'AR aging scan: 10 private/SME demo customers. 4 conditions found, 2 actions raised.',
  'seed'
)
ON CONFLICT (id) DO NOTHING;

-- ── Customers ─────────────────────────────────────────────────────────────────
-- 5 private companies + 5 SMEs

INSERT INTO public.customers (id, company_name, ticker, industry, scenario, credit_limit, current_exposure, payment_terms_days, account_manager, notes, flags)
VALUES
  -- Private companies
  ('c0000002-0000-0000-0000-000000000001',
   'Atlas Precision Manufacturing', NULL, 'Aerospace & Defense', 'credit_deterioration',
   1500000, 1200000, 45, 'Sarah Chen',
   'Private aerospace parts manufacturer. High utilization, negative news on cash flow.', '{}'),

  ('c0000002-0000-0000-0000-000000000002',
   'Meridian Aerospace Components', NULL, 'Aerospace & Defense', 'normal_operations',
   2000000, 850000, 30, 'James Park',
   'Private aerospace components manufacturer. Consistent on-time payer.', '{}'),

  ('c0000002-0000-0000-0000-000000000003',
   'Cascade Industrial Systems', NULL, 'Industrial Equipment', 'payment_issues',
   1200000, 980000, 30, 'Sarah Chen',
   'Private industrial systems integrator. Recurring late payments.', '{}'),

  ('c0000002-0000-0000-0000-000000000004',
   'Northgate Fabrication', NULL, 'Metal Fabrication', 'credit_deterioration',
   800000, 0, 30, 'James Park',
   'Private metal fabricator. No current AR but negative news on financial health.', '{}'),

  ('c0000002-0000-0000-0000-000000000005',
   'Summit Defense Technologies', NULL, 'Aerospace & Defense', 'normal_operations',
   3000000, 1800000, 60, 'Rachel Torres',
   'Private defense contractor. Government-backed contracts, reliable payer.', '{}'),

  -- SME companies
  ('c0000002-0000-0000-0000-000000000006',
   'Brixton Fasteners Ltd', NULL, 'Metal Components', 'payment_issues',
   250000, 220000, 30, 'Rachel Torres',
   'SME fastener manufacturer. Near-critical utilization, recent payment delays.', '{}'),

  ('c0000002-0000-0000-0000-000000000007',
   'Clearwater Coatings Inc', NULL, 'Industrial Coatings', 'normal_operations',
   150000, 65000, 30, 'James Park',
   'SME coatings company. Good payment history, low risk.', '{}'),

  ('c0000002-0000-0000-0000-000000000008',
   'Delta Precision Parts', NULL, 'Precision Manufacturing', 'normal_operations',
   300000, 145000, 30, 'Sarah Chen',
   'SME precision machining shop. Standard risk profile.', '{}'),

  ('c0000002-0000-0000-0000-000000000009',
   'Ironwood Machine Works', NULL, 'Heavy Machinery', 'payment_issues',
   200000, 185000, 30, 'Rachel Torres',
   'SME machine shop. Critical utilization (92.5%), slow payer.', '{}'),

  ('c0000002-0000-0000-0000-000000000010',
   'Pacific Rim Tooling', NULL, 'Precision Manufacturing', 'normal_operations',
   180000, 90000, 30, 'James Park',
   'SME tooling company. Seasonal demand, moderate risk.', '{}')

ON CONFLICT (id) DO NOTHING;

-- ── Invoices ──────────────────────────────────────────────────────────────────
-- Northgate (c0000002-...-0004) has no invoices.
-- Atlas, Meridian, Cascade, Summit, Brixton, Ironwood include historical paid
-- invoices that payment_transactions reference.

INSERT INTO public.invoices (id, customer_id, invoice_number, invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, days_overdue, status, dunning_level, is_demo)
VALUES

  -- ── Atlas Precision Manufacturing ($1.5M limit, target $1.2M outstanding) ──
  -- 31-60 bucket: $500K, 42 days overdue (due 2026-03-18)
  ('b2000001-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000001',
   'ATL-2026-0089', 500000, 0, 500000, '2026-02-01', '2026-03-18', 42, 'overdue', 1, true),
  -- 1-30 bucket: $350K, 18 days overdue (due 2026-04-11)
  ('b2000001-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000001',
   'ATL-2026-0101', 350000, 0, 350000, '2026-02-25', '2026-04-11', 18, 'overdue', 1, true),
  -- Current: $350K, due 2026-05-20
  ('b2000001-0000-0000-0000-000000000003', 'c0000002-0000-0000-0000-000000000001',
   'ATL-2026-0118', 350000, 0, 350000, '2026-04-05', '2026-05-20', 0, 'open', 0, true),
  -- Historical paid (basis for payment_transactions)
  ('b2000001-0000-0000-0000-000000000004', 'c0000002-0000-0000-0000-000000000001',
   'ATL-2025-0412', 400000, 400000, 0, '2025-10-01', '2025-11-15', 0, 'paid', 0, true),
  ('b2000001-0000-0000-0000-000000000005', 'c0000002-0000-0000-0000-000000000001',
   'ATL-2025-0461', 300000, 300000, 0, '2025-12-01', '2026-01-15', 0, 'paid', 0, true),

  -- ── Meridian Aerospace Components ($2M limit, target $850K outstanding) ──────
  -- Current: $450K, due 2026-05-10
  ('b2000002-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000002',
   'MER-2026-0203', 450000, 0, 450000, '2026-04-10', '2026-05-10', 0, 'open', 0, true),
  -- Current: $400K, due 2026-05-25
  ('b2000002-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000002',
   'MER-2026-0218', 400000, 0, 400000, '2026-04-25', '2026-05-25', 0, 'open', 0, true),
  -- Historical paid
  ('b2000002-0000-0000-0000-000000000003', 'c0000002-0000-0000-0000-000000000002',
   'MER-2025-0498', 500000, 500000, 0, '2025-10-15', '2025-11-14', 0, 'paid', 0, true),
  ('b2000002-0000-0000-0000-000000000004', 'c0000002-0000-0000-0000-000000000002',
   'MER-2025-0537', 350000, 350000, 0, '2025-12-01', '2025-12-31', 0, 'paid', 0, true),

  -- ── Cascade Industrial Systems ($1.2M limit, target $980K outstanding) ───────
  -- 31-60 bucket: $420K, 55 days overdue (due 2026-03-05)
  ('b2000003-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000003',
   'CAS-2026-0071', 420000, 0, 420000, '2026-02-03', '2026-03-05', 55, 'overdue', 2, true),
  -- 1-30 bucket: $280K, 22 days overdue (due 2026-04-07)
  ('b2000003-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000003',
   'CAS-2026-0092', 280000, 0, 280000, '2026-03-08', '2026-04-07', 22, 'overdue', 1, true),
  -- Current: $280K, due 2026-05-12
  ('b2000003-0000-0000-0000-000000000003', 'c0000002-0000-0000-0000-000000000003',
   'CAS-2026-0109', 280000, 0, 280000, '2026-04-12', '2026-05-12', 0, 'open', 0, true),
  -- Historical paid
  ('b2000003-0000-0000-0000-000000000004', 'c0000002-0000-0000-0000-000000000003',
   'CAS-2025-0389', 350000, 350000, 0, '2025-10-01', '2025-10-31', 0, 'paid', 0, true),
  ('b2000003-0000-0000-0000-000000000005', 'c0000002-0000-0000-0000-000000000003',
   'CAS-2025-0441', 250000, 250000, 0, '2025-12-10', '2026-01-09', 0, 'paid', 0, true),

  -- ── Summit Defense Technologies ($3M limit, target $1.8M outstanding) ────────
  -- Current: $1M, due 2026-06-01 (60d terms)
  ('b2000005-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000005',
   'SDT-2026-0155', 1000000, 0, 1000000, '2026-04-02', '2026-06-01', 0, 'open', 0, true),
  -- Current: $800K, due 2026-06-10
  ('b2000005-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000005',
   'SDT-2026-0168', 800000, 0, 800000, '2026-04-11', '2026-06-10', 0, 'open', 0, true),
  -- Historical paid
  ('b2000005-0000-0000-0000-000000000003', 'c0000002-0000-0000-0000-000000000005',
   'SDT-2025-0601', 900000, 900000, 0, '2025-09-01', '2025-10-31', 0, 'paid', 0, true),
  ('b2000005-0000-0000-0000-000000000004', 'c0000002-0000-0000-0000-000000000005',
   'SDT-2025-0649', 750000, 750000, 0, '2025-11-01', '2025-12-31', 0, 'paid', 0, true),

  -- ── Brixton Fasteners Ltd ($250K limit, target $220K outstanding) ─────────────
  -- 1-30 bucket: $120K, 15 days overdue (due 2026-04-14)
  ('b2000006-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000006',
   'BXT-2026-0044', 120000, 0, 120000, '2026-03-15', '2026-04-14', 15, 'overdue', 1, true),
  -- Current: $100K, due 2026-05-10
  ('b2000006-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000006',
   'BXT-2026-0051', 100000, 0, 100000, '2026-04-10', '2026-05-10', 0, 'open', 0, true),
  -- Historical paid
  ('b2000006-0000-0000-0000-000000000003', 'c0000002-0000-0000-0000-000000000006',
   'BXT-2025-0312', 80000, 80000, 0, '2025-11-15', '2025-12-15', 0, 'paid', 0, true),

  -- ── Clearwater Coatings Inc ($150K limit, $65K outstanding) ──────────────────
  ('b2000007-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000007',
   'CLW-2026-0028', 65000, 0, 65000, '2026-04-15', '2026-05-15', 0, 'open', 0, true),

  -- ── Delta Precision Parts ($300K limit, $145K outstanding) ───────────────────
  ('b2000008-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000008',
   'DPP-2026-0061', 85000, 0, 85000, '2026-04-08', '2026-05-08', 0, 'open', 0, true),
  ('b2000008-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000008',
   'DPP-2026-0072', 60000, 0, 60000, '2026-04-20', '2026-05-20', 0, 'open', 0, true),

  -- ── Ironwood Machine Works ($200K limit, target $185K outstanding) ────────────
  -- 1-30 bucket: $100K, 20 days overdue (due 2026-04-09)
  ('b2000009-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000009',
   'IRN-2026-0033', 100000, 0, 100000, '2026-03-10', '2026-04-09', 20, 'overdue', 1, true),
  -- 31-60 bucket: $85K, 35 days overdue (due 2026-03-25)
  ('b2000009-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000009',
   'IRN-2026-0021', 85000, 0, 85000, '2026-02-23', '2026-03-25', 35, 'overdue', 2, true),
  -- Historical paid
  ('b2000009-0000-0000-0000-000000000003', 'c0000002-0000-0000-0000-000000000009',
   'IRN-2025-0189', 75000, 75000, 0, '2025-12-01', '2025-12-31', 0, 'paid', 0, true),

  -- ── Pacific Rim Tooling ($180K limit, $90K outstanding) ───────────────────────
  ('b2000010-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000010',
   'PRT-2026-0019', 90000, 0, 90000, '2026-04-18', '2026-05-18', 0, 'open', 0, true)

ON CONFLICT (id) DO NOTHING;

-- ── Payment transactions ───────────────────────────────────────────────────────
-- 6 companies: Atlas (late), Meridian (on time), Cascade (late),
--              Summit (on time), Brixton (late), Ironwood (late)

INSERT INTO public.payment_transactions (id, customer_id, invoice_id, payment_date, amount_paid, payment_method, days_to_pay, days_early_late, on_time, is_demo)
VALUES

  -- Atlas Precision: consistently late (45d terms)
  ('d2000001-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000001',
   'b2000001-0000-0000-0000-000000000004', '2025-12-03', 400000, 'wire', 63, -18, false, true),
  ('d2000001-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000001',
   'b2000001-0000-0000-0000-000000000005', '2026-02-02', 300000, 'wire', 63, -18, false, true),

  -- Meridian Aerospace: reliable on-time payer (30d terms)
  ('d2000002-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000002',
   'b2000002-0000-0000-0000-000000000003', '2025-11-12', 500000, 'ach', 28, 2, true, true),
  ('d2000002-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000002',
   'b2000002-0000-0000-0000-000000000004', '2025-12-29', 350000, 'ach', 28, 2, true, true),

  -- Cascade Industrial: slow payer, trend worsening (30d terms)
  ('d2000003-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000003',
   'b2000003-0000-0000-0000-000000000004', '2025-11-15', 350000, 'wire', 45, -15, false, true),
  ('d2000003-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000003',
   'b2000003-0000-0000-0000-000000000005', '2026-02-01', 250000, 'wire', 53, -23, false, true),

  -- Summit Defense: prompt payer, early settlement pattern (60d terms)
  ('d2000005-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000005',
   'b2000005-0000-0000-0000-000000000003', '2025-10-29', 900000, 'wire', 58, 2, true, true),
  ('d2000005-0000-0000-0000-000000000002', 'c0000002-0000-0000-0000-000000000005',
   'b2000005-0000-0000-0000-000000000004', '2025-12-28', 750000, 'wire', 57, 3, true, true),

  -- Brixton Fasteners: late payer (30d terms)
  ('d2000006-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000006',
   'b2000006-0000-0000-0000-000000000003', '2026-01-02', 80000, 'check', 48, -18, false, true),

  -- Ironwood Machine Works: slow payer, worsening (30d terms)
  ('d2000009-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000009',
   'b2000009-0000-0000-0000-000000000003', '2026-01-18', 75000, 'check', 48, -18, false, true)

ON CONFLICT (id) DO NOTHING;

-- ── Negative news ─────────────────────────────────────────────────────────────

INSERT INTO public.negative_news (id, customer_id, headline, summary, source, news_date, category, severity, sentiment_score, reviewed, agent_name, is_demo)
VALUES
  (
    '00000020-0000-0000-0000-000000000001',
    'c0000002-0000-0000-0000-000000000004',  -- Northgate Fabrication
    'Northgate Fabrication faces insolvency risk as anchor customer exits contract',
    'Industry sources confirm that Northgate Fabrication has lost its largest customer representing an estimated 40% of annual revenue, raising concerns about near-term liquidity and debt servicing capacity.',
    'Bloomberg',
    '2026-04-22',
    'liquidity',
    'high',
    -0.82,
    false,
    'news_monitor_agent',
    true
  ),
  (
    '00000020-0000-0000-0000-000000000002',
    'c0000002-0000-0000-0000-000000000001',  -- Atlas Precision Manufacturing
    'Atlas Precision cash flow under pressure amid supply chain disruption',
    'Atlas Precision Manufacturing is reportedly struggling with extended receivables and rising input costs following disruptions to its titanium supply chain, leading to a deterioration in working capital.',
    'Reuters',
    '2026-04-24',
    'cash_flow',
    'high',
    -0.71,
    false,
    'news_monitor_agent',
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ── Credit events ─────────────────────────────────────────────────────────────

INSERT INTO public.credit_events (id, scope, customer_id, event_type, source_agent, severity, signal_type, title, description, payload, action_required, action_type, action_status, cia_processed, run_id, created_at, is_demo)
VALUES
  (
    'e0000002-0000-0000-0000-000000000001',
    'customer',
    'c0000002-0000-0000-0000-000000000001',
    'HIGH_UTILIZATION',
    'ar_aging_agent',
    'high',
    'AR_AGING',
    'Atlas Precision Manufacturing: HIGH UTILIZATION',
    'Credit utilization at 80% ($1.2M / $1.5M limit). Two overdue invoices in 1-60 day buckets. Payment behaviour consistently late.',
    '{"utilization_pct": 80.0, "credit_limit": 1500000, "current_exposure": 1200000, "dunning_stage": 1}',
    true,
    'CREDIT_LIMIT_REDUCTION',
    'pending',
    false,
    NULL,
    now() - interval '3 hours',
    true
  ),
  (
    'e0000002-0000-0000-0000-000000000002',
    'customer',
    'c0000002-0000-0000-0000-000000000001',
    'NEGATIVE_NEWS_HIGH',
    'news_monitor_agent',
    'high',
    'NEGATIVE_NEWS',
    'Atlas Precision Manufacturing: Cash flow concerns flagged',
    'Negative news detected: cash flow pressure from supply chain disruption and rising input costs.',
    '{"headline": "Atlas Precision cash flow under pressure amid supply chain disruption", "source": "Reuters", "category": "cash_flow", "sentiment_score": -0.71}',
    false,
    null,
    'none',
    false,
    NULL,
    now() - interval '5 hours',
    true
  ),
  (
    'e0000002-0000-0000-0000-000000000003',
    'customer',
    'c0000002-0000-0000-0000-000000000004',
    'NEGATIVE_NEWS_HIGH',
    'news_monitor_agent',
    'high',
    'NEGATIVE_NEWS',
    'Northgate Fabrication: Insolvency risk flagged by media',
    'Negative news detected: major customer contract loss representing ~40% of revenue raises near-term liquidity concerns.',
    '{"headline": "Northgate Fabrication faces insolvency risk as anchor customer exits contract", "source": "Bloomberg", "category": "liquidity", "sentiment_score": -0.82}',
    false,
    null,
    'none',
    false,
    NULL,
    now() - interval '6 hours',
    true
  ),
  (
    'e0000002-0000-0000-0000-000000000004',
    'customer',
    'c0000002-0000-0000-0000-000000000003',
    'PAYMENT_DELAY',
    'ar_aging_agent',
    'medium',
    'AR_AGING',
    'Cascade Industrial Systems: PAYMENT DELAY',
    'Two invoices overdue (55 and 22 days). Payment history shows worsening trend: -15 days → -23 days late on recent settlements.',
    '{"utilization_pct": 81.7, "credit_limit": 1200000, "current_exposure": 980000, "overdue_buckets": {"1_30": 280000, "31_60": 420000}}',
    false,
    null,
    'none',
    false,
    NULL,
    now() - interval '3 hours',
    true
  ),
  (
    'e0000002-0000-0000-0000-000000000005',
    'customer',
    'c0000002-0000-0000-0000-000000000006',
    'HIGH_UTILIZATION',
    'ar_aging_agent',
    'high',
    'AR_AGING',
    'Brixton Fasteners Ltd: HIGH UTILIZATION',
    'Credit utilization at 88% ($220K / $250K limit). Invoice 15 days overdue. SME concentration risk.',
    '{"utilization_pct": 88.0, "credit_limit": 250000, "current_exposure": 220000, "dunning_stage": 1}',
    false,
    null,
    'none',
    false,
    NULL,
    now() - interval '3 hours',
    true
  ),
  (
    'e0000002-0000-0000-0000-000000000006',
    'customer',
    'c0000002-0000-0000-0000-000000000009',
    'CRITICAL_UTILIZATION',
    'ar_aging_agent',
    'critical',
    'AR_AGING',
    'Ironwood Machine Works: CRITICAL UTILIZATION',
    'Credit utilization at 92.5% ($185K / $200K limit). Two overdue invoices (20 and 35 days). Consistent late payment history.',
    '{"utilization_pct": 92.5, "credit_limit": 200000, "current_exposure": 185000, "dunning_stage": 2}',
    true,
    'CREDIT_LIMIT_REDUCTION',
    'pending',
    false,
    NULL,
    now() - interval '3 hours',
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ── Pending actions ───────────────────────────────────────────────────────────

INSERT INTO public.pending_actions (id, run_id, customer_id, agent_name, action_type, rationale, current_value, proposed_value, status, created_at, is_demo)
VALUES
  (
    'a0000002-0000-0000-0000-000000000001',
    '0bb08899-6912-0000-0001-000000000000',
    'c0000002-0000-0000-0000-000000000001',  -- Atlas Precision Manufacturing
    'cia-agent',
    'CREDIT_LIMIT_REDUCTION',
    'High utilization (80%) combined with negative news on cash flow and consistently late payment behaviour (avg 18 days late). Limit reduction recommended to reduce exposure.',
    1500000,
    1100000,
    'pending',
    now() - interval '3 hours',
    true
  ),
  (
    'a0000002-0000-0000-0000-000000000002',
    '0bb08899-6912-0000-0001-000000000000',
    'c0000002-0000-0000-0000-000000000009',  -- Ironwood Machine Works
    'cia-agent',
    'CREDIT_LIMIT_REDUCTION',
    'Critical utilization (92.5%) with two overdue invoices and worsening payment behaviour. Proactive limit reduction to cap exposure at current outstanding level.',
    200000,
    150000,
    'pending',
    now() - interval '3 hours',
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ── Refresh AR aging snapshots from new invoice data ─────────────────────────
SELECT public.fn_refresh_all_ar_aging(CURRENT_DATE);
