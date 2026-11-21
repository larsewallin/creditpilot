-- 20261122000000_approval_authority.sql
-- Approval authority (founder, 2026-11-21): each user can approve a credit limit up to an
-- amount set by role in the Trade Credit Policy (company_settings "policy.approvals":
-- credit analyst $250k, credit manager $1M, admin no ceiling), or by a per-person amount.
-- Above it, the user recommends and the action waits for someone with enough authority.
-- Additive only: no existing data changes.

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS approval_limit_usd bigint
  CHECK (approval_limit_usd IS NULL OR approval_limit_usd >= 0);
COMMENT ON COLUMN public.app_users.approval_limit_usd IS
  'Largest credit limit this person may approve, in USD. NULL = their role''s amount in policy.approvals.';

ALTER TABLE public.pending_actions ADD COLUMN IF NOT EXISTS recommended_by_user uuid REFERENCES auth.users(id);
ALTER TABLE public.pending_actions ADD COLUMN IF NOT EXISTS recommended_by text;
ALTER TABLE public.pending_actions ADD COLUMN IF NOT EXISTS recommended_value bigint; -- already existed (20261014010000); not used for authority, see 20261122010000
ALTER TABLE public.pending_actions ADD COLUMN IF NOT EXISTS recommended_note text;
ALTER TABLE public.pending_actions ADD COLUMN IF NOT EXISTS recommended_at timestamptz;
