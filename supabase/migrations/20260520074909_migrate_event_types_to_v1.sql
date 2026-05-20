-- Migrate existing credit_events to the V1 taxonomy (Path B).
--
-- Renames legacy event_type values to V1 taxonomy names and backfills the
-- new columns (scope, severity_score, summary). Existing payloads are left
-- in their legacy shape — these are pre-taxonomy demo seed rows, never
-- produced by publishEvent. Only newly-emitted events (via publishEvent)
-- will carry schema-correct payloads. The CHECK constraint added in the
-- next migration locks event_type/severity/scope (columns), not payload
-- shape, so legacy payloads remain valid.
--
-- Mapping:
--   NEGATIVE_NEWS_HIGH     -> NEWS_EVENT                   (severity high)
--   CRITICAL_UTILIZATION   -> UTILIZATION_THRESHOLD_BREACH (severity critical)
--   HIGH_UTILIZATION       -> UTILIZATION_THRESHOLD_BREACH (severity high)
--   GOING_CONCERN_WARNING  -> GOING_CONCERN               (severity critical)
--   PAYMENT_DELAY          -> OVERDUE_INVOICE             (severity medium)
--   COVENANT_WAIVER        -> COVENANT_WAIVER             (no rename)
--
-- severity_score backfill follows the taxonomy mapping:
--   critical=92, high=75, medium=52, low=27, info=7

BEGIN;

-- ── NEWS_EVENT ───────────────────────────────────────────────────────────
UPDATE credit_events
SET event_type = 'NEWS_EVENT',
    severity_score = 75,
    scope = 'customer',
    summary = COALESCE(summary, title)
WHERE event_type = 'NEGATIVE_NEWS_HIGH';

-- ── UTILIZATION_THRESHOLD_BREACH (critical) ──────────────────────────────
UPDATE credit_events
SET event_type = 'UTILIZATION_THRESHOLD_BREACH',
    severity_score = 92,
    scope = 'customer',
    summary = COALESCE(summary, title)
WHERE event_type = 'CRITICAL_UTILIZATION';

-- ── UTILIZATION_THRESHOLD_BREACH (high) ──────────────────────────────────
UPDATE credit_events
SET event_type = 'UTILIZATION_THRESHOLD_BREACH',
    severity_score = 75,
    scope = 'customer',
    summary = COALESCE(summary, title)
WHERE event_type = 'HIGH_UTILIZATION';

-- ── GOING_CONCERN ────────────────────────────────────────────────────────
UPDATE credit_events
SET event_type = 'GOING_CONCERN',
    severity_score = 92,
    scope = 'customer',
    summary = COALESCE(summary, title)
WHERE event_type = 'GOING_CONCERN_WARNING';

-- ── OVERDUE_INVOICE ──────────────────────────────────────────────────────
UPDATE credit_events
SET event_type = 'OVERDUE_INVOICE',
    severity_score = 52,
    scope = 'customer',
    summary = COALESCE(summary, title)
WHERE event_type = 'PAYMENT_DELAY';

-- ── COVENANT_WAIVER (no rename, just backfill new columns) ────────────────
UPDATE credit_events
SET severity_score = 75,
    scope = 'customer',
    summary = COALESCE(summary, title)
WHERE event_type = 'COVENANT_WAIVER';

-- ── Safety backfill: any remaining rows with NULL severity_score/scope ───
-- (defensive; should be none after the above)
UPDATE credit_events
SET severity_score = CASE severity
      WHEN 'critical' THEN 92
      WHEN 'high' THEN 75
      WHEN 'medium' THEN 52
      WHEN 'low' THEN 27
      ELSE 7
    END
WHERE severity_score IS NULL;

UPDATE credit_events
SET scope = 'customer'
WHERE scope IS NULL;

COMMIT;
