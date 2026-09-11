-- Add is_demo flag to agent_messages, credit_events, and pending_actions
-- Allows frontend to filter demo vs live data and reset logic to avoid hardcoded UUIDs

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE public.credit_events
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE public.pending_actions
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Tag seed rows from 20260419220602_demo_seed_data.sql
UPDATE public.credit_events
  SET is_demo = true
  WHERE id IN (
    'e0000001-0000-0000-0000-000000000001',
    'e0000001-0000-0000-0000-000000000002',
    'e0000001-0000-0000-0000-000000000003',
    'e0000001-0000-0000-0000-000000000004',
    'e0000001-0000-0000-0000-000000000005',
    'e0000001-0000-0000-0000-000000000006',
    'e0000001-0000-0000-0000-000000000007'
  );

UPDATE public.pending_actions
  SET is_demo = true
  WHERE id IN (
    'a0000001-0000-0000-0000-000000000001',
    'a0000001-0000-0000-0000-000000000002',
    'a0000001-0000-0000-0000-000000000003'
  );

-- Tag any agent_messages that were created by demo seed runs
-- (cia-agent demo path returns early before inserting agent_messages, so no CIA run_id needed)
UPDATE public.agent_messages
  SET is_demo = true
  WHERE run_id IN (
    '0aa07788-5801-48ad-b070-384389296dee',
    'cfab84c3-2a44-4c60-97a1-c0dbe50d1015',
    '04238087-3999-4aac-a368-5a820a603194'
  );
