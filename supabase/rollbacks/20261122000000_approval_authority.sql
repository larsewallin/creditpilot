-- Rollback for 20261122000000_approval_authority.sql. Removes per-person approval amounts and
-- recorded recommendations: run only with the founder's go-ahead.
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_at;
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_note;
-- recommended_value is NOT dropped: it predates this migration (20261014010000, the CIA's
-- recommended amount for a new customer) and this migration did not add it.
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_by;
ALTER TABLE public.pending_actions DROP COLUMN IF EXISTS recommended_by_user;
ALTER TABLE public.app_users DROP COLUMN IF EXISTS approval_limit_usd;
