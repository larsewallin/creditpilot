// publishEvent — the only path through which agents write to credit_events.
//
// Responsibilities:
//   1. Validate the payload against the appropriate Zod schema for event_type
//   2. Keep severity (qualitative) and severity_score (numeric) in sync
//   3. Set correlation_id = own id when this is a root event (no parent_event_id)
//   4. Require summary field when severity >= medium
//   5. Insert into credit_events
//
// This is the gateway / anti-corruption layer for the V1 taxonomy.
// Every agent uses this; no agent inserts into credit_events directly.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getPayloadSchema,
  severityToScore,
  scoreToSeverity,
  type Severity,
  type Scope,
  type EventType,
} from "./event_schemas.ts";

export interface PublishEventInput {
  event_type: EventType;
  severity?: Severity;
  severity_score?: number;
  scope: Scope;
  customer_id?: string | null;
  source_agent: string;
  correlation_id?: string;
  parent_event_id?: string | null;
  title: string;
  description: string;
  summary?: string;
  payload: Record<string, unknown>;
  is_demo?: boolean;
}

export interface PublishEventResult {
  id: string;
  correlation_id: string;
  severity: Severity;
  severity_score: number;
}

// Reuses a single client per Edge Function invocation when called repeatedly.
let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("publishEvent: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export async function publishEvent(input: PublishEventInput): Promise<PublishEventResult> {

  // ─── 1. Validate scope/customer_id consistency ───────────────────────────
  if (input.scope === "customer" && !input.customer_id) {
    throw new Error("publishEvent: customer_id is required when scope='customer'");
  }
  if (input.scope !== "customer" && input.customer_id) {
    throw new Error(`publishEvent: customer_id must be null when scope='${input.scope}'`);
  }

  // ─── 2. Validate payload against the event type's Zod schema ─────────────
  const schema = getPayloadSchema(input.event_type);
  const parseResult = schema.safeParse(input.payload);
  if (!parseResult.success) {
    throw new Error(
      `publishEvent: payload validation failed for ${input.event_type}: ${parseResult.error.message}`,
    );
  }
  const validatedPayload = parseResult.data;

  // ─── 3. Reconcile severity (qualitative) and severity_score (numeric) ────
  let severity: Severity;
  let severity_score: number;

  const providedSeverity = input.severity;
  const providedScore = input.severity_score ?? (validatedPayload as { severity_score?: number }).severity_score;

  if (providedSeverity !== undefined && providedScore !== undefined) {
    // Both provided — must be consistent
    const expectedSeverity = scoreToSeverity(providedScore);
    if (expectedSeverity !== providedSeverity) {
      throw new Error(
        `publishEvent: severity '${providedSeverity}' and severity_score ${providedScore} are inconsistent. Score ${providedScore} maps to '${expectedSeverity}'.`,
      );
    }
    severity = providedSeverity;
    severity_score = providedScore;
  } else if (providedSeverity !== undefined) {
    severity = providedSeverity;
    severity_score = severityToScore(providedSeverity);
  } else if (providedScore !== undefined) {
    severity_score = providedScore;
    severity = scoreToSeverity(providedScore);
  } else {
    throw new Error("publishEvent: must provide severity or severity_score (or both)");
  }

  // ─── 4. Require summary for severity >= medium ───────────────────────────
  const severityRequiresSummary = ["critical", "high", "medium"].includes(severity);
  if (severityRequiresSummary && !input.summary) {
    throw new Error(
      `publishEvent: summary is required for severity='${severity}' (severity >= medium).`,
    );
  }

  // ─── 5. Generate id, set correlation_id for root events ──────────────────
  const id = crypto.randomUUID();
  const correlation_id = input.correlation_id ?? id;

  // ─── 6. Insert into credit_events ────────────────────────────────────────
  const client = getClient();
  const { error } = await client.from("credit_events").insert({
    id,
    event_type: input.event_type,
    severity,
    severity_score,
    scope: input.scope,
    customer_id: input.customer_id ?? null,
    source_agent: input.source_agent,
    correlation_id,
    parent_event_id: input.parent_event_id ?? null,
    title: input.title,
    description: input.description,
    summary: input.summary ?? null,
    payload: validatedPayload,
    is_demo: input.is_demo ?? false,
  });

  if (error) {
    throw new Error(`publishEvent: insert failed: ${error.message}`);
  }

  return { id, correlation_id, severity, severity_score };
}
