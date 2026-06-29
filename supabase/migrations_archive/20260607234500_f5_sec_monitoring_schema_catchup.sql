-- F5: catch-up migration so a fresh rebuild of sec_monitoring matches live.
-- Bidirectional drift found: 6 live columns absent from migrations; migrations
-- add ai_risk_score/ai_summary (dropped from live); CREATE has risk_signals
-- (renamed to risk_signals_detected in live). This reconciles structure.
-- Idempotent: no-op against current live (everything already matches); corrective
-- only on a fresh rebuild-from-migrations.
-- Verified: no-op against current live (all ADDs/DROPs skip via IF [NOT] EXISTS,
-- column_count stays 17). Corrective only on fresh rebuild-from-migrations.

BEGIN;

ALTER TABLE public.sec_monitoring
  ADD COLUMN IF NOT EXISTS monitoring_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS filing_types_monitored text[] DEFAULT ARRAY['10-K','10-Q','8-K'],
  ADD COLUMN IF NOT EXISTS last_8k_date date,
  ADD COLUMN IF NOT EXISTS risk_signals_detected text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS next_scheduled_review date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.sec_monitoring DROP COLUMN IF EXISTS ai_risk_score;
ALTER TABLE public.sec_monitoring DROP COLUMN IF EXISTS ai_summary;
ALTER TABLE public.sec_monitoring DROP COLUMN IF EXISTS risk_signals;

COMMIT;
