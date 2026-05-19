-- Add taxonomy support columns to credit_events and align the existing
-- scope CHECK constraint with the V1 event taxonomy.
--
-- Idempotent: uses IF NOT EXISTS for new columns so the migration can
-- run cleanly even if a previous partial attempt added some of them.
--
-- The existing parent_event_id column is the V1 taxonomy's 'triggered_by'
-- concept; we use parent_event_id as the canonical name (the taxonomy doc
-- is being updated to match). No new column is added for it.

-- New columns to support the V1 taxonomy
ALTER TABLE credit_events
  ADD COLUMN IF NOT EXISTS severity_score integer,
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS summary text;

-- Update the scope CHECK constraint to match the V1 taxonomy values.
-- Old constraint allowed: customer | industry | country | macro
-- New constraint allows:  customer | country | industry | currency | portfolio
-- (drops 'macro', adds 'currency' and 'portfolio')
-- A SELECT against the table confirmed no existing rows use 'macro', so
-- no data migration is needed.
ALTER TABLE credit_events
  DROP CONSTRAINT IF EXISTS credit_events_scope_check;

ALTER TABLE credit_events
  ADD CONSTRAINT credit_events_scope_check
  CHECK (scope IN ('customer', 'country', 'industry', 'currency', 'portfolio'));

-- Index for correlation_id lookups (cascade queries)
CREATE INDEX IF NOT EXISTS credit_events_correlation_id_idx
  ON credit_events(correlation_id);

COMMENT ON COLUMN credit_events.severity_score IS
  'V1 taxonomy: numeric 0-100 severity, kept in sync with qualitative severity by publishEvent helper.';
COMMENT ON COLUMN credit_events.correlation_id IS
  'V1 taxonomy: groups events in a cascade. Set to event id for root events.';
COMMENT ON COLUMN credit_events.summary IS
  'V1 taxonomy: AI-generated summary for severity >= medium events; templated for lower severities.';
COMMENT ON COLUMN credit_events.parent_event_id IS
  'V1 taxonomy: immediate parent event id. NULL for root events. (This column existed prior to V1 taxonomy and serves as the triggered_by field.)';
