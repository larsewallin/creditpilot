-- Rollback for 20261122040000_demo_policy_groups.sql: takes the demo customers out of the
-- starter groups again (demo rows only; no customer data lost).
UPDATE public.customers SET policy_group = NULL
 WHERE private.is_public_demo() AND policy_group IN ('strategic', 'export', 'high_risk');
