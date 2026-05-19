-- Idempotency tracking table for the V1 event taxonomy.
--
-- When an agent (consumer) processes an event, it inserts a row here.
-- Before processing an event, consumers check if (agent_name, event_id)
-- exists; if yes, the event was already processed and is skipped.
--
-- This prevents reruns after crashes from double-counting and lets the
-- system safely replay events without producing duplicate side effects.

CREATE TABLE IF NOT EXISTS agent_processed_events (
  agent_name text NOT NULL,
  event_id uuid NOT NULL REFERENCES credit_events(id) ON DELETE CASCADE,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_name, event_id)
);

-- Lookups by event_id for diagnostics ('which agents processed this event?')
CREATE INDEX IF NOT EXISTS agent_processed_events_event_id_idx
  ON agent_processed_events(event_id);

COMMENT ON TABLE agent_processed_events IS
  'V1 taxonomy: idempotency tracking. Consumers record (agent_name, event_id) after processing an event. Prevents duplicate processing on rerun.';
