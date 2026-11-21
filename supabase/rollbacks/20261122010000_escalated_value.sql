-- Rollback for 20261122010000_escalated_value.sql. Removes recorded escalation amounts:
-- run only with the founder's go-ahead.
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS escalated_value;
