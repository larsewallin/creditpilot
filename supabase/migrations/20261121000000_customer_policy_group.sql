-- 20261121000000_customer_policy_group.sql
-- Trade Credit Policy (founder, 2026-11-20): a customer can belong to one customer group
-- (Strategic, High risk, Export, or a group the company adds). The group's rule overrides live
-- in company_settings "policy.groups"; this column says which group a customer is in.
-- NULL = the company-wide policy applies. Additive only: no existing data changes.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS policy_group text;
COMMENT ON COLUMN public.customers.policy_group IS
  'Key of the customer''s group in company_settings policy.groups; NULL = company-wide policy.';
