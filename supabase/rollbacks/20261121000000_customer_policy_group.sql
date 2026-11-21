-- Rollback for 20261121000000_customer_policy_group.sql. Removes every customer's group
-- assignment (the groups' rules in company_settings stay): run only with the founder's go-ahead.
ALTER TABLE public.customers DROP COLUMN IF EXISTS policy_group;
