-- supabase/migrations/YYYYMMDDHHMMSS_cia_agent.sql
-- CIA agent: ensure credit_events has all required columns and indexes

-- Add cia_decision column if not present (CIA can log its recommendation)
ALTER TABLE credit_events
  ADD COLUMN IF NOT EXISTS cia_decision text,
  ADD COLUMN IF NOT EXISTS cia_processed_at timestamptz;

-- Index for CIA polling unprocessed events efficiently
CREATE INDEX IF NOT EXISTS idx_credit_events_cia_unprocessed
  ON credit_events (cia_processed, created_at DESC)
  WHERE cia_processed = false;

-- Index for customer + severity lookups (CIA portfolio view)
CREATE INDEX IF NOT EXISTS idx_credit_events_customer_severity
  ON credit_events (customer_id, severity, created_at DESC);

-- Index for source_agent + created_at (staleness checks)
CREATE INDEX IF NOT EXISTS idx_credit_events_source_agent
  ON credit_events (source_agent, created_at DESC);

-- Allow anon to read CIA briefing events (for public demo)
-- Assumes RLS is enabled and anon role needs SELECT on credit_events
-- Adjust policy name to match your existing patterns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'credit_events'
      AND policyname = 'anon_select_credit_events'
  ) THEN
    CREATE POLICY anon_select_credit_events ON credit_events
      FOR SELECT TO anon USING (true);
  END IF;
END $$;
