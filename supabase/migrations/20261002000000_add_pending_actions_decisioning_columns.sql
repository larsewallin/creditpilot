-- cia-agent's credit-limit decisioning step (Step 6b, enabled as part of F0,
-- 2026-09-30) inserts reduction_pct, severity, and source_event_ids on every
-- pending_actions row -- but no migration ever added these columns. The
-- insert has been failing on every single run since 6b was enabled,
-- silently (console.error only, never surfaced), meaning the real
-- decisioning pipeline has never actually written a single pending_action
-- in this deployment's history. Confirmed live via Supabase function logs
-- during F5 verification: PGRST204 "Could not find the 'reduction_pct'
-- column of 'pending_actions' in the schema cache".
--
-- Column choices match cia-agent/index.ts's actual insert shape and
-- assess-composite-risk.ts's CompositeRiskResult['severity'] union type:
--   reduction_pct     -- proposal.reduction_pct, always an integer (Math.round in
--                         calculate-credit-limit-proposal.ts)
--   severity          -- riskAssessment.severity: 'critical' | 'high' | 'medium' | 'info'
--   source_event_ids  -- custEvents.map(e => e.id), same uuid[] convention already used
--                         by invoice_ids / customer_ids elsewhere in this schema

ALTER TABLE public.pending_actions
  ADD COLUMN reduction_pct integer,
  ADD COLUMN severity text,
  ADD COLUMN source_event_ids uuid[];

ALTER TABLE public.pending_actions
  ADD CONSTRAINT pending_actions_severity_check
  CHECK (severity IS NULL OR severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'info'::text]));
