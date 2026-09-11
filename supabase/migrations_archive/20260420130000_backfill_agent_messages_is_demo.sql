-- Backfill is_demo = true for agent_messages rows from demo seed runs
-- Catches any rows that existed before the is_demo column was added
UPDATE public.agent_messages
  SET is_demo = true
  WHERE run_id IN (
    '0aa07788-5801-48ad-b070-384389296dee',
    'cfab84c3-2a44-4c60-97a1-c0dbe50d1015',
    '04238087-3999-4aac-a368-5a820a603194'
  );
