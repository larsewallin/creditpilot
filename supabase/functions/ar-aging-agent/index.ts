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
 * Also emits OVERDUE_AR (A3): one event per customer with active overdue
 * invoices (status NOT IN paid/written_off/pre_petition, days_overdue > 0).
 * Severity by worst non-empty bucket: over_90→critical, 61_90→high,
 * 31_60→medium, 1_30→low. Concentration removed entirely (future agent).
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
 * Event types emitted: UTILIZATION_THRESHOLD_BREACH, OVERDUE_AR
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

  // Demo repeatability: clear this agent's prior demo events so each demo run
  // reproduces the same output. Gated on DEMO_MODE — production never self-deletes
  // (real findings accumulate over time). Scoped to this agent's own events only.
  if (DEMO_MODE) {
    const { error: resetError } = await supabase
      .from("credit_events")
      .delete()
      .eq("source_agent", agent_name)
      .eq("is_demo", true);
    if (resetError) {
      console.error("[ar-aging-agent] demo reset failed:", JSON.stringify(resetError));
    }
  }

  try {
    // Read breaching customers. Join the aging view to customers for the
    // authoritative current_exposure (the view exposes utilization_pct and
    // credit_limit but not current_exposure; using current_exposure keeps the
    // payload's exposure/limit/percent internally consistent).
    const { data: rows, error: rowsError } = await supabase
      .from("v_ar_aging_current")
      .select("customer_id, company_name, credit_limit, utilization_pct")
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

    // --- OVERDUE_AR: one event per customer with active overdue invoices ---
    const { data: overdueInvoices, error: overdueError } = await supabase
      .from("invoices")
      .select("customer_id, amount_outstanding, days_overdue")
      .not("status", "in", "(paid,written_off,pre_petition)")
      .gt("days_overdue", 0);

    if (overdueError) {
      console.error("[ar-aging-agent] overdue invoices query failed:", JSON.stringify(overdueError));
    }

    // Group by customer, compute buckets
    const overdueByCustomer = new Map<string, {
      bucket_1_30: number;
      bucket_31_60: number;
      bucket_61_90: number;
      bucket_over_90: number;
      invoice_count: number;
      oldest_days: number;
    }>();

    for (const inv of (overdueInvoices ?? [])) {
      const amount = Number(inv.amount_outstanding) || 0;
      const days = Number(inv.days_overdue) || 0;
      const custId: string = inv.customer_id;
      if (!overdueByCustomer.has(custId)) {
        overdueByCustomer.set(custId, { bucket_1_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_over_90: 0, invoice_count: 0, oldest_days: 0 });
      }
      const c = overdueByCustomer.get(custId)!;
      c.invoice_count++;
      if (days > c.oldest_days) c.oldest_days = days;
      if (days > 90)      c.bucket_over_90 += amount;
      else if (days > 60) c.bucket_61_90   += amount;
      else if (days > 30) c.bucket_31_60   += amount;
      else                c.bucket_1_30    += amount;
    }

    let overdueFound = 0;
    if (overdueByCustomer.size > 0) {
      const overdueIds = [...overdueByCustomer.keys()];
      const { data: overdueCusts } = await supabase
        .from("customers")
        .select("id, company_name")
        .in("id", overdueIds);
      const nameById = new Map((overdueCusts ?? []).map((c: any) => [c.id as string, c.company_name as string]));

      for (const [custId, buckets] of overdueByCustomer) {
        const companyName: string = nameById.get(custId) ?? custId;
        const total = buckets.bucket_1_30 + buckets.bucket_31_60 + buckets.bucket_61_90 + buckets.bucket_over_90;

        // Severity by worst non-empty bucket
        let severity: "critical" | "high" | "medium" | "low";
        let severityScore: number;
        let worstBucket: string;
        if (buckets.bucket_over_90 > 0)      { severity = "critical"; severityScore = 92; worstBucket = "90+"; }
        else if (buckets.bucket_61_90 > 0)   { severity = "high";     severityScore = 75; worstBucket = "61–90"; }
        else if (buckets.bucket_31_60 > 0)   { severity = "medium";   severityScore = 55; worstBucket = "31–60"; }
        else                                  { severity = "low";      severityScore = 30; worstBucket = "1–30"; }

        const summary = `${companyName}: $${total.toLocaleString()} overdue across ${buckets.invoice_count} invoice${buckets.invoice_count !== 1 ? "s" : ""} (worst bucket: ${worstBucket} days, oldest ${buckets.oldest_days} days past due).`;

        try {
          await publishEvent({
            event_type:   "OVERDUE_AR",
            severity,
            scope:        "customer",
            customer_id:  custId,
            source_agent: agent_name,
            title:        `${companyName}: $${total.toLocaleString()} overdue AR`,
            description:  summary,
            summary,
            payload: {
              severity_score:              severityScore,
              total_overdue_usd:           total,
              bucket_1_30_usd:             buckets.bucket_1_30,
              bucket_31_60_usd:            buckets.bucket_31_60,
              bucket_61_90_usd:            buckets.bucket_61_90,
              bucket_over_90_usd:          buckets.bucket_over_90,
              invoice_count:               buckets.invoice_count,
              oldest_invoice_days_overdue: buckets.oldest_days,
            },
            is_demo: DEMO_MODE,
          });
          overdueFound++;
        } catch (err) {
          console.error(`[ar-aging-agent] OVERDUE_AR publishEvent failed for ${companyName}:`, (err as Error).message);
        }
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned,
      conditions_found: conditionsFound + overdueFound,
      messages_composed: 0,
      summary: `Scanned ${scanned} customers over ${UTILIZATION_HIGH}% utilization. Emitted ${conditionsFound} utilization breach events and ${overdueFound} overdue AR events.`,
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
