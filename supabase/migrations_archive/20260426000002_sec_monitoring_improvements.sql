-- Add alert_date, alert_action_taken, last_checked_at, is_demo to sec_monitoring
-- (referenced in agent code but missing from schema)
ALTER TABLE public.sec_monitoring
  ADD COLUMN IF NOT EXISTS alert_date date,
  ADD COLUMN IF NOT EXISTS alert_action_taken text,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Add accession_number and is_demo to sec_filings for deduplication
ALTER TABLE public.sec_filings
  ADD COLUMN IF NOT EXISTS accession_number text,
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Unique index on accession_number per customer for dedup
CREATE UNIQUE INDEX IF NOT EXISTS sec_filings_accession_customer_idx
  ON public.sec_filings (customer_id, accession_number)
  WHERE accession_number IS NOT NULL;

-- Note: v_sec_monitoring_dashboard view not updated here.
-- The new sec-monitor-agent queries sec_monitoring directly and does not use the view.
-- The view is kept as-is for any frontend code that reads it.

-- Tag existing sec_monitoring rows as demo
UPDATE public.sec_monitoring SET is_demo = true WHERE is_demo = false;

-- Tag existing sec_filings rows as demo
UPDATE public.sec_filings SET is_demo = true WHERE is_demo = false;

-- Add anon INSERT on sec_monitoring (needed for frontend to add new monitored companies)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sec_monitoring' AND policyname = 'anon_insert_sec_monitoring'
  ) THEN
    CREATE POLICY anon_insert_sec_monitoring ON sec_monitoring
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;
