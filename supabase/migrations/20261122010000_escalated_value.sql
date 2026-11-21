-- 20261122010000_escalated_value.sql
-- Fix for 20261122000000: pending_actions.recommended_value already held the CIA's recommended
-- amount for a new customer (20261014010000), so the amount a user recommends above their
-- approval authority gets its own column. Who, when and the note stay in recommended_by_user,
-- recommended_by, recommended_at and recommended_note (added by 20261122000000).
-- Additive only. No row had used the authority path when this was written.
ALTER TABLE public.pending_actions ADD COLUMN IF NOT EXISTS escalated_value bigint;
COMMENT ON COLUMN public.pending_actions.escalated_value IS
  'Amount a user recommended above their approval authority; someone whose authority covers it must approve.';
COMMENT ON COLUMN public.pending_actions.recommended_by_user IS
  'Set when a user recommended an amount above their approval authority (escalated_value).';
