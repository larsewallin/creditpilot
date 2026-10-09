/**
 * Risk Agent — supabase/functions/risk-agent/index.ts
 *
 * Synthesis agent. Takes the customer-less (macro) events from the Country, Industry and FX agents
 * and maps them onto the customers they actually touch. Emits via publishEvent only; never writes
 * pending_actions (CIA owns those).
 *
 * Emits:
 *   RISK_CHANGE         (scope customer)  — a customer where adverse macro signals converge across
 *                                           2+ distinct dimensions (country, industry, currency).
 *                                           CIA reads it as one more agent and lowers the customer's
 *                                           utilization threshold (see assess-composite-risk.ts).
 *   MACRO_TREND_WARNING (scope portfolio) — one per country cluster of converging customers.
 *
 * Counts macro-derived signals only, never a customer's own events, so nothing CIA already sees is
 * counted twice. Single-dimension exposure is not flagged here; it already shows on its own page.
 * Currency counts only for customers with UNHEDGED invoices in that currency.
 *
 * Run order: after country/industry/fx agents, before cia-agent.
 * Rate limit 60 min; DEMO_MODE self-resets this agent's demo credit_events; same-day dedup.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";
import {
  buildClusters,
  correlateCustomer,
  type MacroCustomer,
  type MacroEvent,
} from "../_shared/skills/analytical/correlate-macro-exposure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const SOURCE_AGENTS = ["country_risk_agent", "industry_risk_agent", "fx_risk_agent"];
const LIVE_LOOKBACK_DAYS = 7;

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "risk_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns, error: recentRunsError } = await supabase
    .from("agent_runs").select("id, started_at, status")
    .eq("agent_name", agent_name).gte("started_at", cutoff).in("status", ["completed", "running"]).limit(1);
  if (recentRunsError) console.error("[risk-agent] agent_runs query failed:", recentRunsError.message);

  if (recentRuns && recentRuns.length > 0) {
    return new Response(JSON.stringify({
      error: "rate_limited",
      message: "This agent was run recently. Please wait before running again.",
      last_run_at: recentRuns[0].started_at,
    }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const run_id = crypto.randomUUID();
  await supabase.from("agent_runs").insert({
    id: run_id, agent_name, status: "running", started_at: new Date().toISOString(), triggered_by,
  });

  if (DEMO_MODE) {
    const { error: resetError } = await supabase
      .from("credit_events").delete().eq("source_agent", agent_name).eq("is_demo", true);
    if (resetError) console.error("[risk-agent] demo reset failed:", JSON.stringify(resetError));
  }

  try {
    const now = new Date();

    // 1. Macro events (customer-less) from the three upstream agents.
    let evQuery = supabase.from("credit_events")
      .select("id, event_type, severity, title, summary, payload, created_at")
      .in("source_agent", SOURCE_AGENTS).is("customer_id", null).eq("is_demo", DEMO_MODE);
    if (!DEMO_MODE) {
      evQuery = evQuery.gte("created_at", new Date(now.getTime() - LIVE_LOOKBACK_DAYS * 86_400_000).toISOString());
    }
    const { data: evRows, error: evError } = await evQuery;
    if (evError) throw evError;
    const events = (evRows ?? []) as MacroEvent[];

    // 2. Customers with exposure.
    const { data: custRows, error: custError } = await supabase
      .from("customers").select("id, company_name, country_code, sector, current_exposure").gt("current_exposure", 0);
    if (custError) throw custError;
    const customers: MacroCustomer[] = (custRows ?? []).map((c: any) => ({
      id: c.id, company_name: c.company_name, country_code: c.country_code, sector: c.sector,
      current_exposure: Number(c.current_exposure ?? 0),
    }));

    // 3. Unhedged USD exposure per customer and currency.
    const { data: fxRows, error: fxError } = await supabase
      .from("v_fx_exposure_by_invoice").select("customer_id, currency, usd_at_booking, fx_hedged").eq("is_demo", DEMO_MODE);
    if (fxError) console.error("[risk-agent] fx exposure query failed:", JSON.stringify(fxError));
    const unhedged = new Map<string, Record<string, number>>();
    for (const r of fxRows ?? []) {
      if ((r as any).fx_hedged) continue;
      const m = unhedged.get((r as any).customer_id) ?? {};
      m[(r as any).currency] = (m[(r as any).currency] ?? 0) + Number((r as any).usd_at_booking);
      unhedged.set((r as any).customer_id, m);
    }

    // 4. Correlate.
    const results = customers
      .map((c) => correlateCustomer(c, events, unhedged.get(c.id) ?? {}))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const clusters = buildClusters(results, customers);

    // 5. Dedup (same day).
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data: already, error: alreadyError } = await supabase
      .from("credit_events").select("event_type, customer_id, payload")
      .eq("source_agent", agent_name).eq("is_demo", DEMO_MODE).gte("created_at", todayStart);
    if (alreadyError) console.error("[risk-agent] dedup pre-fetch failed:", JSON.stringify(alreadyError));
    const emitted = new Set((already ?? []).map((e: any) =>
      e.event_type === "RISK_CHANGE" ? `cust:${e.customer_id}` : `cluster:${e.payload?.affected_countries?.[0]}`));

    let conditionsFound = 0;

    for (const r of results) {
      if (emitted.has(`cust:${r.customer_id}`)) continue;
      const bits = r.components.map((c) => c.text);
      const summary = `${r.company_name}: adverse signals converge across ${r.dimensions.length} dimensions ` +
        `(${r.dimensions.join(", ")}). ${bits.join("; ")}. Exposure ${usd(r.exposure_usd)}.`;
      try {
        await publishEvent({
          event_type: "RISK_CHANGE", severity: r.severity, scope: "customer", customer_id: r.customer_id,
          source_agent: agent_name, run_id,
          title: `${r.company_name}: macro risk converging (${r.dimensions.length} dimensions)`,
          description: summary, summary,
          payload: {
            severity_score: severityToScore(r.severity),
            change_type: "escalation",
            risk_components: r.components.map((c) => ({
              type: c.event_type, severity_score: severityToScore(c.severity), source_event_id: c.event_id,
            })),
            prior_risk_score: 0,
            new_risk_score: r.risk_score,
            reasoning: summary,
            summary,
            dimension_count: r.dimensions.length,
            dimensions: r.dimensions,
            exposure_usd: Math.round(r.exposure_usd),
          },
          is_demo: DEMO_MODE,
        } as any);
        conditionsFound++;
      } catch (err) {
        console.error(`[risk-agent] RISK_CHANGE publishEvent failed for ${r.customer_id}:`, (err as Error).message);
      }
    }

    for (const cl of clusters) {
      if (emitted.has(`cluster:${cl.country_code}`)) continue;
      const summary = `${cl.country_code}: ${cl.customers.length} customer${cl.customers.length !== 1 ? "s" : ""} ` +
        `(${usd(cl.exposure_usd)} exposure) face converging adverse signals across ${cl.dimensions.join(", ")}.`;
      try {
        await publishEvent({
          event_type: "MACRO_TREND_WARNING", severity: cl.severity, scope: "portfolio", customer_id: null,
          source_agent: agent_name, run_id,
          title: `${cl.country_code}: converging macro risk on ${usd(cl.exposure_usd)} of exposure`,
          description: summary, summary,
          payload: {
            theme: `${cl.country_code} country, sector and currency stress`,
            time_horizon_months: 3,
            confidence: cl.confidence,
            affected_sectors: cl.sectors,
            affected_countries: [cl.country_code],
            summary,
            exposure_usd: Math.round(cl.exposure_usd),
            customers_affected: cl.customers.length,
            dimensions: cl.dimensions,
            top_customers: cl.customers.slice(0, 3).map((c) => ({
              customer_id: c.customer_id, company_name: c.company_name, exposure_usd: Math.round(c.exposure_usd),
            })),
          },
          is_demo: DEMO_MODE,
        } as any);
        conditionsFound++;
      } catch (err) {
        console.error(`[risk-agent] MACRO_TREND_WARNING publishEvent failed for ${cl.country_code}:`, (err as Error).message);
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: customers.length,
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `Mapped ${events.length} macro events onto ${customers.length} customers. ` +
        `${results.length} converging, ${clusters.length} country clusters. Emitted ${conditionsFound} events.`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({
      run_id, status: "completed", macro_events: events.length,
      customers_converging: results.length, clusters: clusters.length, events: conditionsFound,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = (err as any)?.message ?? JSON.stringify(err);
    await supabase.from("agent_runs").update({
      status: "failed", completed_at: new Date().toISOString(), summary: `Error: ${msg}`,
    }).eq("id", run_id);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
