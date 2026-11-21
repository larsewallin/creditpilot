-- 20261122040000_demo_policy_groups.sql
-- Same statements as the 2026-11-21 groups block at the end of scripts/demo-third-party-ratings.sql (keep in step).

-- 2026-11-21 (migration 20261122040000): demo customers in the starter policy groups, so the
-- demo shows how a group changes the rules (founder, 2026-11-21). Demo rows only.
UPDATE public.customers SET policy_group = 'strategic'
 WHERE private.is_public_demo() AND policy_group IS NULL
   AND company_name IN ('The Boeing Company', 'Lockheed Martin Corporation', 'Raytheon Technologies (RTX)');

UPDATE public.customers SET policy_group = 'export'
 WHERE private.is_public_demo() AND policy_group IS NULL
   AND lifecycle_status = 'active' AND country_code <> 'US';

UPDATE public.customers SET policy_group = 'high_risk'
 WHERE private.is_public_demo() AND policy_group IS NULL
   AND company_name IN ('Brixton Fasteners Ltd', 'Cascade Industrial Systems');
