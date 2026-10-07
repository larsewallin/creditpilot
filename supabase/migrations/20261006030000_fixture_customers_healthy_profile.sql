-- G1 follow-up: give the 23 fixture buyers a healthy, usable demo profile.
--
-- WHAT: for the 23 fixture customers copied in 20261006010000:
--   1. credit rating scores into 60-85 (16 already are; 7 weak ones get 62-79),
--      payment_health 'healthy', stable trend, scenario normal_operations, no risk tags;
--   2. every late payment becomes an on-time (early) payment, so all 8 payments per
--      customer are on time;
--   3. 2-3 current invoices per customer (35-60% of credit limit), due dates anchored via
--      demo_days_offset so they stay in the future after each demo reset.
-- WHY: the demo portfolio already has plenty of high-risk customers, events and actions; these
--      buyers are for the FX / Country Risk / onboarding demos and should read as good,
--      creditworthy accounts. Invoices give them exposure so FX/Country agents can see them.
-- CONVENTION: invoice_amount / exposure are USD (reporting currency, same as credit_limit);
--      invoices.currency records the buyer's invoicing currency (USD/EUR/JPY) for FX exposure.
-- SCOPE: only the 23 fixture UUIDs. Idempotent: invoices are guarded by WHERE NOT EXISTS on
--      invoice_number (globally unique); the UPDATEs converge to the same values on re-run.
-- HOW: migrate.sh wraps this in a transaction; no BEGIN/COMMIT here.

CREATE TEMP TABLE _fx_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _fx_ids VALUES
  ('03b94656-a278-471e-bb4f-48b3806e74c3'),
  ('15539364-d6bb-4410-b129-bfb82e4a89cc'),
  ('1a8289e1-3a75-4dba-a20a-126c87b66152'),
  ('208368cb-d541-464b-9c7f-ae3bb5c04caa'),
  ('23e7dfdd-2e24-4e5b-8e90-06fc40801b11'),
  ('2b0d3875-2670-4894-82e5-d9ae48182132'),
  ('399b1b6e-ad50-43ef-8334-dffe5ad7ed80'),
  ('490d5062-99e1-4b3d-ae4a-aca50b0dcbc0'),
  ('49def7e6-8eb4-49d2-9fee-b47f02668fc3'),
  ('564a6076-b225-4951-ae08-d3b0dcf8e75d'),
  ('5ac02a9d-224f-41c9-9024-85fb9b441405'),
  ('5b90243b-a069-4266-8d32-aabbcd2f0c97'),
  ('5dad5be8-f0d9-450c-a82e-fb04d0527e54'),
  ('5e69b546-ffec-4334-91fd-77b258113131'),
  ('7f878380-c15a-4752-ab31-e4f87a6a6e5f'),
  ('8f9de98b-dc36-40f5-a7f5-13786dd3a3a0'),
  ('9a062cf8-6b58-4d36-aff0-6f6ab9622c58'),
  ('a92b716b-3ea1-428f-b0ac-a28450daf3e0'),
  ('a9663059-ea83-4674-9e6c-69ac735224fb'),
  ('bcb3a080-af6e-46b6-8a5f-926df1bc35e4'),
  ('c9bc33c6-daeb-426a-ad23-d18d0cb1030a'),
  ('eb7e8a16-6ccc-498b-bf64-b919cf8bce5d'),
  ('f39dc224-9ad8-477c-8305-c60e8e61d5e0');

-- 1. Customer profile
UPDATE customers c SET
  credit_rating_score = CASE
    WHEN c.credit_rating_score BETWEEN 60 AND 85 THEN c.credit_rating_score
    ELSE 62 + (abs(hashtext(c.id::text)) % 18)
  END,
  credit_rating_previous_score = NULL,
  scenario = 'normal_operations',
  risk_tags = '{}',
  payment_health = 'healthy',
  payment_trend = 'stable',
  payment_on_time_rate = 1,
  payment_avg_days_early_late = -(3 + (abs(hashtext(c.id::text)) % 6))
WHERE c.id IN (SELECT id FROM _fx_ids);

-- 2. Payments: every payment on time (early by 2-9 days)
UPDATE payment_transactions p SET
  days_early_late  = -(2 + (abs(hashtext(p.id::text)) % 8)),
  invoice_due_date = p.payment_date + (2 + (abs(hashtext(p.id::text)) % 8)),
  on_time          = true
WHERE p.customer_id IN (SELECT id FROM _fx_ids)
  AND (p.on_time IS DISTINCT FROM true OR p.days_early_late > 0);

-- 3. Current invoices (exposure recalculated by trg_exposure_recalc)
INSERT INTO invoices
  (customer_id, invoice_number, invoice_amount, amount_paid, invoice_date, due_date,
   days_overdue, status, is_demo, outstanding_amount, currency, demo_days_offset, product_description)
SELECT v.customer_id::uuid, v.invoice_number, v.amount, 0,
       CURRENT_DATE + v.off - v.terms, CURRENT_DATE + v.off,
       0, 'current', true, v.amount, v.cur, v.off, 'Demo fixture invoice'
FROM (VALUES
  ('23e7dfdd-2e24-4e5b-8e90-06fc40801b11', 'FX-ALPE-23E7-001', 301000, 12, 45, 'EUR'),
  ('23e7dfdd-2e24-4e5b-8e90-06fc40801b11', 'FX-ALPE-23E7-002', 263000, 27, 45, 'EUR'),
  ('23e7dfdd-2e24-4e5b-8e90-06fc40801b11', 'FX-ALPE-23E7-003', 188000, 41, 45, 'EUR'),
  ('399b1b6e-ad50-43ef-8334-dffe5ad7ed80', 'FX-BAYE-399B-001', 636000, 12, 45, 'EUR'),
  ('399b1b6e-ad50-43ef-8334-dffe5ad7ed80', 'FX-BAYE-399B-002', 556000, 27, 45, 'EUR'),
  ('399b1b6e-ad50-43ef-8334-dffe5ad7ed80', 'FX-BAYE-399B-003', 397000, 41, 45, 'EUR'),
  ('a9663059-ea83-4674-9e6c-69ac735224fb', 'FX-BLAC-A966-001', 231000, 12, 45, 'USD'),
  ('a9663059-ea83-4674-9e6c-69ac735224fb', 'FX-BLAC-A966-002', 202000, 27, 45, 'USD'),
  ('a9663059-ea83-4674-9e6c-69ac735224fb', 'FX-BLAC-A966-003', 144000, 41, 45, 'USD'),
  ('5dad5be8-f0d9-450c-a82e-fb04d0527e54', 'FX-CASC-5DAD-001', 436000, 12, 45, 'USD'),
  ('5dad5be8-f0d9-450c-a82e-fb04d0527e54', 'FX-CASC-5DAD-002', 382000, 27, 45, 'USD'),
  ('5dad5be8-f0d9-450c-a82e-fb04d0527e54', 'FX-CASC-5DAD-003', 273000, 41, 45, 'USD'),
  ('208368cb-d541-464b-9c7f-ae3bb5c04caa', 'FX-CHUB-2083-001', 198000, 12, 45, 'JPY'),
  ('208368cb-d541-464b-9c7f-ae3bb5c04caa', 'FX-CHUB-2083-002', 198000, 27, 45, 'JPY'),
  ('8f9de98b-dc36-40f5-a7f5-13786dd3a3a0', 'FX-CONT-8F9D-001', 295000, 12, 45, 'USD'),
  ('8f9de98b-dc36-40f5-a7f5-13786dd3a3a0', 'FX-CONT-8F9D-002', 258000, 27, 45, 'USD'),
  ('8f9de98b-dc36-40f5-a7f5-13786dd3a3a0', 'FX-CONT-8F9D-003', 184000, 41, 45, 'USD'),
  ('2b0d3875-2670-4894-82e5-d9ae48182132', 'FX-DEUT-2B0D-001', 336000, 12, 45, 'EUR'),
  ('2b0d3875-2670-4894-82e5-d9ae48182132', 'FX-DEUT-2B0D-002', 294000, 27, 45, 'EUR'),
  ('2b0d3875-2670-4894-82e5-d9ae48182132', 'FX-DEUT-2B0D-003', 210000, 41, 45, 'EUR'),
  ('5e69b546-ffec-4334-91fd-77b258113131', 'FX-GULF-5E69-001', 315000, 12, 45, 'USD'),
  ('5e69b546-ffec-4334-91fd-77b258113131', 'FX-GULF-5E69-002', 315000, 27, 45, 'USD'),
  ('a92b716b-3ea1-428f-b0ac-a28450daf3e0', 'FX-HANS-A92B-001', 478000, 12, 45, 'EUR'),
  ('a92b716b-3ea1-428f-b0ac-a28450daf3e0', 'FX-HANS-A92B-002', 418000, 27, 45, 'EUR'),
  ('a92b716b-3ea1-428f-b0ac-a28450daf3e0', 'FX-HANS-A92B-003', 299000, 41, 45, 'EUR'),
  ('9a062cf8-6b58-4d36-aff0-6f6ab9622c58', 'FX-HEAR-9A06-001', 328000, 12, 45, 'USD'),
  ('9a062cf8-6b58-4d36-aff0-6f6ab9622c58', 'FX-HEAR-9A06-002', 328000, 27, 45, 'USD'),
  ('bcb3a080-af6e-46b6-8a5f-926df1bc35e4', 'FX-HOKK-BCB3-001', 348000, 12, 45, 'JPY'),
  ('bcb3a080-af6e-46b6-8a5f-926df1bc35e4', 'FX-HOKK-BCB3-002', 348000, 27, 45, 'JPY'),
  ('564a6076-b225-4951-ae08-d3b0dcf8e75d', 'FX-KANS-564A-001', 797000, 12, 45, 'JPY'),
  ('564a6076-b225-4951-ae08-d3b0dcf8e75d', 'FX-KANS-564A-002', 797000, 27, 45, 'JPY'),
  ('5ac02a9d-224f-41c9-9024-85fb9b441405', 'FX-LONE-5AC0-001', 719000, 12, 45, 'USD'),
  ('5ac02a9d-224f-41c9-9024-85fb9b441405', 'FX-LONE-5AC0-002', 719000, 27, 45, 'USD'),
  ('7f878380-c15a-4752-ab31-e4f87a6a6e5f', 'FX-NIPP-7F87-001', 311000, 12, 45, 'JPY'),
  ('7f878380-c15a-4752-ab31-e4f87a6a6e5f', 'FX-NIPP-7F87-002', 272000, 27, 45, 'JPY'),
  ('7f878380-c15a-4752-ab31-e4f87a6a6e5f', 'FX-NIPP-7F87-003', 194000, 41, 45, 'JPY'),
  ('490d5062-99e1-4b3d-ae4a-aca50b0dcbc0', 'FX-NIPP-490D-001', 460000, 12, 45, 'JPY'),
  ('490d5062-99e1-4b3d-ae4a-aca50b0dcbc0', 'FX-NIPP-490D-002', 403000, 27, 45, 'JPY'),
  ('490d5062-99e1-4b3d-ae4a-aca50b0dcbc0', 'FX-NIPP-490D-003', 288000, 41, 45, 'JPY'),
  ('f39dc224-9ad8-477c-8305-c60e8e61d5e0', 'FX-NORD-F39D-001', 273000, 12, 45, 'EUR'),
  ('f39dc224-9ad8-477c-8305-c60e8e61d5e0', 'FX-NORD-F39D-002', 239000, 27, 45, 'EUR'),
  ('f39dc224-9ad8-477c-8305-c60e8e61d5e0', 'FX-NORD-F39D-003', 171000, 41, 45, 'EUR'),
  ('49def7e6-8eb4-49d2-9fee-b47f02668fc3', 'FX-OSAK-49DE-001', 362000, 12, 45, 'JPY'),
  ('49def7e6-8eb4-49d2-9fee-b47f02668fc3', 'FX-OSAK-49DE-002', 317000, 27, 45, 'JPY'),
  ('49def7e6-8eb4-49d2-9fee-b47f02668fc3', 'FX-OSAK-49DE-003', 226000, 41, 45, 'JPY'),
  ('c9bc33c6-daeb-426a-ad23-d18d0cb1030a', 'FX-PERM-C9BC-001', 393000, 12, 45, 'USD'),
  ('c9bc33c6-daeb-426a-ad23-d18d0cb1030a', 'FX-PERM-C9BC-002', 344000, 27, 45, 'USD'),
  ('c9bc33c6-daeb-426a-ad23-d18d0cb1030a', 'FX-PERM-C9BC-003', 245000, 41, 45, 'USD'),
  ('5b90243b-a069-4266-8d32-aabbcd2f0c97', 'FX-RHEI-5B90-001', 431000, 12, 45, 'EUR'),
  ('5b90243b-a069-4266-8d32-aabbcd2f0c97', 'FX-RHEI-5B90-002', 377000, 27, 45, 'EUR'),
  ('5b90243b-a069-4266-8d32-aabbcd2f0c97', 'FX-RHEI-5B90-003', 269000, 41, 45, 'EUR'),
  ('15539364-d6bb-4410-b129-bfb82e4a89cc', 'FX-RUHR-1553-001', 248000, 12, 45, 'EUR'),
  ('15539364-d6bb-4410-b129-bfb82e4a89cc', 'FX-RUHR-1553-002', 217000, 27, 45, 'EUR'),
  ('15539364-d6bb-4410-b129-bfb82e4a89cc', 'FX-RUHR-1553-003', 155000, 41, 45, 'EUR'),
  ('eb7e8a16-6ccc-498b-bf64-b919cf8bce5d', 'FX-SCHW-EB7E-001', 198000, 12, 45, 'EUR'),
  ('eb7e8a16-6ccc-498b-bf64-b919cf8bce5d', 'FX-SCHW-EB7E-002', 173000, 27, 45, 'EUR'),
  ('eb7e8a16-6ccc-498b-bf64-b919cf8bce5d', 'FX-SCHW-EB7E-003', 123000, 41, 45, 'EUR'),
  ('1a8289e1-3a75-4dba-a20a-126c87b66152', 'FX-SIER-1A82-001', 244000, 12, 45, 'USD'),
  ('1a8289e1-3a75-4dba-a20a-126c87b66152', 'FX-SIER-1A82-002', 244000, 27, 45, 'USD'),
  ('03b94656-a278-471e-bb4f-48b3806e74c3', 'FX-TOHO-03B9-001', 250000, 12, 45, 'JPY'),
  ('03b94656-a278-471e-bb4f-48b3806e74c3', 'FX-TOHO-03B9-002', 219000, 27, 45, 'JPY'),
  ('03b94656-a278-471e-bb4f-48b3806e74c3', 'FX-TOHO-03B9-003', 156000, 41, 45, 'JPY')
) AS v(customer_id, invoice_number, amount, off, terms, cur)
WHERE NOT EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.invoice_number = v.invoice_number
);
