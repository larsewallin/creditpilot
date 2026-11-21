-- Rollback for 20261122000000_approval_authority.sql. Removes per-person approval amounts and
-- recorded recommendations: run only with the founder's go-ahead.
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_at;
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_note;
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_value;
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_by;
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_by_user;
ALTER TABLE public.app_users DROP COLUMN IF EXISTS approval_limit_usd;
