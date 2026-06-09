/**
 * AR Aging Agent — supabase/functions/ar-aging-agent/index.ts
 *
 * Pure signal agent — emits credit_events via publishEvent only.
 *
 * SCOPE (utilization-only build): scans customers for high credit utilization
 * and emits UTILIZATION_THRESHOLD_BREACH. Also refreshes payment-behaviour
 * fields on the customers table (the CIA reads these; AR is currently their
 * sole writer).
 *
 * DEFERRED (see backlog): the overdue-AR side (OVERDUE_INVOICE) and its dunning
 * letters / over-90 Teams alerts are NOT in this build — pending the B4
 * taxonomy pass deciding OVERDUE_INVOICE grain. Concentration was removed
 * entirely (belongs to a future portfolio agent).
 *
 * Utilization is current_exposure / credit_limit (the authoritative figures on
 * the customers table). The agent reads current_exposure from customers so the
 * event payload's exposure, limit, and percent reconcile.
 *
 * Request body: { triggered_by?: string }
 * Response:     { run_id: string, status: "completed" }
 *
 * Tables read:  v_ar_aging_current, customers, payment_transactions
 * Tables written: credit_events (via publishEvent), customers (payment fields),
 *                 agent_runs
 * Event types emitted: UTILIZATION_THRESHOLD_BREACH
 *
 * Rate limit: 60 minutes between runs (HTTP 429 if exceeded).
 * Demo mode:  reads the same view as production (the view reflects is_demo
 *             data); the only difference is is_demo stamped on output.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { analysePaymentBehaviour } from "../_shared/skills/analytical/analyse-payment-behaviour.ts";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const UTILIZATION_HIGH = 80;      // > 80% = high
const UTILIZATION_CRITICAL = 95;  // > 95% = critical
const MAX_CUSTOMERS = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "ar_aging_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  // --- Rate limit check ---
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns } = await supabase
    .from("agent_runs")
    .select("id, started_at, status")
    .eq("agent_name", agent_name)
    .gte("started_at", cutoff)
    .in("status", ["completed", "running"])
    .limit(1);

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

  try {
    // Read breaching customers. Join the aging view to customers for the
    // authoritative current_exposure (the view exposes utilization_pct and
    // credit_limit but not current_exposure; using current_exposure keeps the
    // payload's exposure/limit/percent internally consistent).
    const { data: rows, error: rowsError } = await supabase
      .from("v_ar_aging_current")
      .select("customer_id, company_name, ticker, credit_limit, utilization_pct")
      .gt("utilization_pct", UTILIZATION_HIGH)
      .order("utilization_pct", { ascending: false })
      .limit(MAX_CUSTOMERS);

    if (rowsError) {
      console.error("[ar-aging-agent] v_ar_aging_current query failed:", JSON.stringify(rowsError));
      throw rowsError;
    }

    // current_exposure is the authoritative exposure (customers table). The view
    // does not expose it and the client can't embed-join a view, so fetch it in
    // one batched query keyed by the breaching customer ids.
    const breachingIds = (rows ?? []).map((r) => r.customer_id);
    const exposureById = new Map<string, { current_exposure: number; credit_rating_score: number | null }>();
    if (breachingIds.length > 0) {
      const { data: custRows, error: custError } = await supabase
        .from("customers")
        .select("id, current_exposure, credit_rating_score")
        .in("id", breachingIds);
      if (custError) {
        console.error("[ar-aging-agent] customers exposure query failed:", JSON.stringify(custError));
        throw custError;
      }
      for (const c of (custRows ?? [])) {
        exposureById.set(c.id as string, {
          current_exposure: Number(c.current_exposure) || 0,
          credit_rating_score: c.credit_rating_score as number | null,
        });
      }
    }

    const scanned = rows?.length ?? 0;
    let conditionsFound = 0;

    for (const row of (rows ?? [])) {
      const customerId: string = row.customer_id;
      const companyName: string = row.company_name;
      const creditLimit: number = Number(row.credit_limit) || 0;
      const utilizationPct: number = Number(row.utilization_pct) || 0;
      const custInfo = exposureById.get(customerId);
      const currentExposure: number = custInfo?.current_exposure ?? 0;
      const creditRatingScore: number | null = custInfo?.credit_rating_score ?? null;

      // --- Payment-behaviour refresh (CIA depends on these fields; AR is sole writer) ---
      const { data: transactions } = await supabase
        .from("payment_transactions")
        .select("payment_date, days_to_pay, days_early_late, on_time, amount:amount_paid")
        .eq("customer_id", customerId)
        .order("payment_date", { ascending: false })
        .limit(24);

      const behaviour = analysePaymentBehaviour(transactions ?? []);

      const { error: behaviourError } = await supabase.from("customers").update({
        payment_on_time_rate: behaviour.on_time_rate,
        payment_avg_days_early_late: behaviour.avg_days_early_late,
        payment_trend: behaviour.trend,
        payment_health: behaviour.health,
        payment_behaviour_updated_at: new Date().toISOString(),
      }).eq("id", customerId);
      if (behaviourError) {
        console.error("[ar-aging-agent] payment behaviour update failed:", JSON.stringify(behaviourError));
      }

      // --- Decide whether this utilization is a RISK worth emitting ---
      // High utilization alone is NOT a risk (a strong customer using their line
      // is normal). It is only an event when (a) over the limit — always a
      // control breach — or (b) high utilization combined with a weak credit
      // signal. Otherwise emit nothing.
      const overLimit = utilizationPct > 100;
      // 'watch' is the mild monitoring tier, not a concern signal — only
      // 'at_risk' (deteriorating AND paying poorly) counts as a weak signal.
      const weakSignal =
        (creditRatingScore !== null && creditRatingScore < 50) ||
        behaviour.health === "at_risk" ||
        behaviour.trend === "deteriorating";

      if (!overLimit && !weakSignal) {
        continue; // strong customer under limit — high utilization is not a risk
      }

      // --- Emit UTILIZATION_THRESHOLD_BREACH ---
      const severity = overLimit ? "critical" : "high";
      const thresholdCrossed = utilizationPct > UTILIZATION_CRITICAL ? UTILIZATION_CRITICAL : UTILIZATION_HIGH;
      const overageUsd = currentExposure > creditLimit ? (currentExposure - creditLimit) : null;
      const overText = overageUsd !== null ? ` (over limit by $${overageUsd.toLocaleString()})` : "";
      const summary = `${companyName}: credit utilization at ${utilizationPct.toFixed(1)}% of a $${creditLimit.toLocaleString()} limit${overText}.`;

      try {
        await publishEvent({
          event_type:   "UTILIZATION_THRESHOLD_BREACH",
          severity,
          scope:        "customer",
          customer_id:  customerId,
          source_agent: agent_name,
          title:        `${companyName}: Credit utilization at ${utilizationPct.toFixed(1)}%`,
          description:  summary,
          summary,
          payload: {
            severity_score:      severityToScore(severity),
            current_exposure_usd: currentExposure,
            credit_limit_usd:     creditLimit,
            utilization_percent:  utilizationPct,
            threshold_crossed:    thresholdCrossed,
            overage_usd:          overageUsd,
          },
          is_demo: DEMO_MODE,
        });
        conditionsFound++;
      } catch (err) {
        console.error(`[ar-aging-agent] publishEvent failed for ${companyName}:`, (err as Error).message);
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned,
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `Scanned ${scanned} customers over ${UTILIZATION_HIGH}% utilization. Emitted ${conditionsFound} utilization breach events.`,
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
