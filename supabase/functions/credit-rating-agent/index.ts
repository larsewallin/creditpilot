/**
 * Credit Rating Change Monitor Agent — supabase/functions/credit-rating-agent/index.ts
 *
 * Pure signal agent — emits credit_events via publishEvent only. Does NOT write
 * pending_actions: CIA is the sole owner of credit-limit decisioning and already
 * derives a synthetic CREDIT_RATING_DOWNGRADE (-10pp composite-risk threshold) from the
 * same customers columns. This agent makes that signal visible and auditable as a real
 * event on the Credit Events feed.
 *
 * Logic, per customer with current_exposure > 0 and both credit_rating_score and
 * credit_rating_previous_score set: detectRatingChange(previous, current)
 * (see skills/analytical/detect-rating-change.ts for thresholds). Changes under 5 points
 * emit nothing. Upgrades are severity info.
 *
 * Score feed: customers.credit_rating_score / credit_rating_previous_score /
 * credit_rating_updated_at are populated by whatever feeds ratings (demo: seeded; live
 * feed is a future integration). This agent only reads them.
 *
 * Idempotency: one event per rating change. A change is "already reported" when this
 * agent has emitted the same event_type for the customer at/after
 * customers.credit_rating_updated_at (or, if that is null, within the last 24h).
 * Live runs also ignore changes older than RECENCY_DAYS. Demo runs self-reset this
 * agent's prior demo events first and skip the recency window (seeded dates age).
 *
 * Request body: { triggered_by?: string }
 * Response:     { run_id: string, status: "completed" }
 *
 * Tables read:  customers, credit_events (dedup check)
 * Tables written: credit_events (via publishEvent), agent_runs
 * Event types emitted: CREDIT_RATING_DOWNGRADE, CREDIT_RATING_UPGRADE
 *
 * Rate limit: 60 minutes between runs (HTTP 429 if exceeded).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { detectRatingChange } from "../_shared/skills/analytical/detect-rating-change.ts";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const MAX_CUSTOMERS = 200;
const RECENCY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_TYPES = ["CREDIT_RATING_DOWNGRADE", "CREDIT_RATING_UPGRADE"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "credit_rating_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  // --- Rate limit check ---
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns, error: recentRunsError } = await supabase
    .from("agent_runs")
    .select("id, started_at, status")
    .eq("agent_name", agent_name)
    .gte("started_at", cutoff)
    .in("status", ["completed", "running"])
    .limit(1);
  if (recentRunsError) console.error("[credit-rating-agent] agent_runs query failed:", recentRunsError.message);

  if (recentRuns && recentRuns.length > 0) {
    return new Response(JSON.stringify({
      error: "rate_limited",
      message: "This agent was run recently. Please wait before running again.",
      last_run_at: recentRuns[0].started_at,
    }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const run_id = crypto.randomUUID();
  await supabase.from("agent_runs").insert({
    id: run_id,
    agent_name,
    status: "running",
    started_at: new Date().toISOString(),
    triggered_by,
  });

  // Demo repeatability: clear this agent's prior demo events. Production never self-deletes.
  if (DEMO_MODE) {
    const { error: resetError } = await supabase
      .from("credit_events")
      .delete()
      .eq("source_agent", agent_name)
      .eq("is_demo", true);
    if (resetError) console.error("[credit-rating-agent] demo reset failed:", JSON.stringify(resetError));
  }

  try {
    const now = new Date();

    // 1. Candidate customers: positive exposure with a score pair.
    const { data: customers, error: customersError } = await supabase
      .from("customers")
      .select("id, company_name, current_exposure, credit_rating_score, credit_rating_previous_score, credit_rating_raw, credit_rating_source, credit_rating_updated_at")
      .gt("current_exposure", 0)
      .not("credit_rating_score", "is", null)
      .not("credit_rating_previous_score", "is", null)
      .order("current_exposure", { ascending: false })
      .limit(MAX_CUSTOMERS);
    if (customersError) {
      console.error("[credit-rating-agent] customers query failed:", JSON.stringify(customersError));
      throw customersError;
    }
    const scanned = customers?.length ?? 0;

    // 2. Latest emission per (customer, type) for dedup, one batched query.
    const lookback = new Date(now.getTime() - 2 * RECENCY_DAYS * MS_PER_DAY).toISOString();
    const { data: prior, error: priorError } = await supabase
      .from("credit_events")
      .select("customer_id, event_type, created_at")
      .eq("source_agent", agent_name)
      .eq("is_demo", DEMO_MODE)
      .in("event_type", EVENT_TYPES)
      .gte("created_at", lookback);
    if (priorError) console.error("[credit-rating-agent] dedup pre-fetch failed:", JSON.stringify(priorError));
    const lastEmitted = new Map<string, number>();
    for (const e of (prior ?? []) as any[]) {
      const k = `${e.customer_id}:${e.event_type}`;
      const t = new Date(e.created_at).getTime();
      if (t > (lastEmitted.get(k) ?? 0)) lastEmitted.set(k, t);
    }

    let conditionsFound = 0;

    // 3. Evaluate each customer.
    for (const c of (customers ?? []) as any[]) {
      const change = detectRatingChange(Number(c.credit_rating_previous_score), Number(c.credit_rating_score));
      if (!change.type || !change.severity) continue;

      const updatedAt = c.credit_rating_updated_at ? new Date(c.credit_rating_updated_at).getTime() : null;
      if (!DEMO_MODE && updatedAt !== null && now.getTime() - updatedAt > RECENCY_DAYS * MS_PER_DAY) continue;

      const changeSince = updatedAt ?? now.getTime() - MS_PER_DAY;
      const last = lastEmitted.get(`${c.id}:${change.type}`);
      if (last !== undefined && last >= changeSince) continue;

      const absDelta = Math.abs(change.delta);
      const direction = change.type === "CREDIT_RATING_DOWNGRADE" ? "downgraded" : "upgraded";
      const ratingText = c.credit_rating_raw ? ` (now ${c.credit_rating_raw})` : "";
      const summary = `${c.company_name}: credit rating ${direction}${ratingText} — score ${change.previous_score} → ${change.current_score} (${change.delta > 0 ? "+" : ""}${change.delta} pts).` +
        (change.action_required ? " Review of the credit limit is recommended." : "");

      try {
        await publishEvent({
          event_type:   change.type,
          severity:     change.severity,
          scope:        "customer",
          customer_id:  c.id,
          source_agent: agent_name,
          run_id,
          title:        `${c.company_name}: Credit rating ${direction} (${absDelta} pts)`,
          description:  summary,
          summary,
          payload: {
            severity_score:  severityToScore(change.severity),
            previous_score:  change.previous_score,
            current_score:   change.current_score,
            delta:           change.delta,
            action_required: change.action_required,
            current_rating:  c.credit_rating_raw ?? null,
            rating_source:   c.credit_rating_source ?? null,
            summary,
          },
          is_demo: DEMO_MODE,
        });
        conditionsFound++;
      } catch (err) {
        console.error(`[credit-rating-agent] ${change.type} publishEvent failed for ${c.company_name}:`, (err as Error).message);
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned,
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `Scanned ${scanned} customers with a rating score pair. Emitted ${conditionsFound} rating-change events.`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ run_id, status: "completed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await supabase.from("agent_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      summary: `Error: ${(err as Error).message}`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
