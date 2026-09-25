/**
 * Industry Risk Monitor Agent — supabase/functions/industry-risk-agent/index.ts
 *
 * Pure signal agent — emits credit_events via publishEvent only. Built on the
 * sec-monitor-agent reference pattern: DEMO_MODE ? seed : live at the fetch
 * boundary only, error capture on every Supabase query, human-readable titles.
 *
 * First industry-scoped emitter (SEC/News/AR/Payment Behaviour are all
 * scope='customer'). This agent is scope='industry', customer_id always null
 * — one sector's signal is relevant to every customer in that sector, not one
 * specific customer. Confirmed both publishEvent.ts and the credit_events
 * schema already support this correctly: ScopeEnum includes 'industry', the
 * scope CHECK constraint allows it, and customer_id has no NOT NULL — nothing
 * needed changing there.
 *
 * Only checks sectors actually present in the portfolio (customers with
 * current_exposure > 0), not all 7 sectors unconditionally — an empty sector
 * has no customers whose risk this could inform.
 *
 * Two independent signal types per sector, each with its own firing rule:
 *   INDUSTRY_DOWNTURN   — from FredBlsSource (econ). change_percent is
 *     normalized to the sector's producer/consumer exposure direction
 *     (sector-exposure-direction.ts, Phase 3) before the firing threshold is
 *     even checked, so "negative" always means deterioration for that
 *     specific sector, never a raw unsigned market move. Fires only when the
 *     normalized change is a material decline: -5 to -10 → medium,
 *     -10 to -15 → high, -15 or worse → critical.
 *   INDUSTRY_DISRUPTION — from GdeltSource (news). Every qualifying article
 *     fires — the news source itself is the selection filter, unlike the
 *     econ side's magnitude threshold. Severity: natural_disaster/
 *     geopolitical → high (typically systemic); everything else → medium.
 *
 * Idempotency: same pattern as payment-behaviour-agent — dedup against
 * credit_events directly (agent_processed_events is orphaned, see
 * docs/LEGACY_TABLES.md), scoped to today. Finer-grained than Payment
 * Behaviour's (customer_id, event_type) key, though: a sector can have
 * multiple independent econ indicators (e.g. Energy has both commodity_price
 * and production_output) or multiple independent news articles fire the same
 * event_type on the same day, and each is a genuinely distinct signal, not a
 * duplicate. Fingerprint is (sector, event_type, indicator) for
 * INDUSTRY_DOWNTURN and (sector, event_type, headline) for
 * INDUSTRY_DISRUPTION.
 *
 * Request body: { triggered_by?: string }
 * Response:     { run_id: string, status: "completed" }
 *
 * Tables read:  customers, credit_events (dedup check), seed_industry_econ_signals
 *               / seed_industry_news (demo mode only)
 * Tables written: credit_events (via publishEvent), agent_runs
 * Event types emitted: INDUSTRY_DOWNTURN, INDUSTRY_DISRUPTION
 *
 * Rate limit: 60 minutes between runs (HTTP 429 if exceeded).
 * Demo mode:  DEMO_MODE ? read seed_industry_econ_signals/seed_industry_news
 *             : FredBlsSource (needs FRED_API_KEY) + GdeltSource (no key
 *             needed, public API). Self-resets this agent's prior demo
 *             credit_events before each demo run, matching every other agent.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  FredBlsSource,
  GdeltSource,
  fetchSeedEconSignals,
  fetchSeedNewsSignals,
  type IndustrySignalSource,
  type RawEconSignal,
  type RawNewsSignal,
} from "../_shared/skills/integration/fetch-industry-signal.ts";
import { getIndicatorsForSector, normalizeChangePercent } from "../_shared/skills/analytical/sector-exposure-direction.ts";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const SIGNAL_LOOKBACK_DAYS = 30; // how far back GdeltSource looks for news, live mode only

function downturnSeverity(normalizedChangePercent: number): "medium" | "high" | "critical" | null {
  if (normalizedChangePercent > -5) return null; // not material
  if (normalizedChangePercent <= -15) return "critical";
  if (normalizedChangePercent <= -10) return "high";
  return "medium";
}

function disruptionSeverity(disruptionType: RawNewsSignal["disruption_type"]): "medium" | "high" {
  return disruptionType === "natural_disaster" || disruptionType === "geopolitical" ? "high" : "medium";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "industry_risk_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";
  const FRED_API_KEY = Deno.env.get("FRED_API_KEY");

  const econSource: IndustrySignalSource = new FredBlsSource(FRED_API_KEY);
  const newsSource: IndustrySignalSource = new GdeltSource();

  // --- Rate limit check ---
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns, error: recentRunsError } = await supabase
    .from("agent_runs")
    .select("id, started_at, status")
    .eq("agent_name", agent_name)
    .gte("started_at", cutoff)
    .in("status", ["completed", "running"])
    .limit(1);
  if (recentRunsError) console.error("[industry-risk-agent] agent_runs query failed:", recentRunsError.message);

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

  if (DEMO_MODE) {
    const { error: resetError } = await supabase
      .from("credit_events")
      .delete()
      .eq("source_agent", agent_name)
      .eq("is_demo", true);
    if (resetError) {
      console.error("[industry-risk-agent] demo reset failed:", JSON.stringify(resetError));
    }
  }

  try {
    const now = new Date();
    const since = new Date(now.getTime() - SIGNAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    // 1. Sectors actually present in the portfolio (current_exposure > 0).
    const { data: customerRows, error: customersError } = await supabase
      .from("customers")
      .select("sector")
      .gt("current_exposure", 0);
    if (customersError) {
      console.error("[industry-risk-agent] customers query failed:", JSON.stringify(customersError));
      throw customersError;
    }
    const sectors = [...new Set((customerRows ?? []).map((c) => c.sector as string))].filter(
      (s) => s !== "Other" // no single indicator applies to a catch-all sector — nothing to check
    );

    const scanned = sectors.length;

    // 2. Pre-fetch today's already-emitted (sector, event_type, discriminator)
    //    fingerprints for this agent, in one batched query.
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data: alreadyEmitted, error: alreadyEmittedError } = await supabase
      .from("credit_events")
      .select("payload, event_type")
      .eq("source_agent", agent_name)
      .eq("is_demo", DEMO_MODE)
      .in("event_type", ["INDUSTRY_DOWNTURN", "INDUSTRY_DISRUPTION"])
      .gte("created_at", todayStart);
    if (alreadyEmittedError) {
      console.error("[industry-risk-agent] dedup pre-fetch failed:", JSON.stringify(alreadyEmittedError));
    }
    const emittedToday = new Set(
      (alreadyEmitted ?? []).map((e: any) => {
        const p = e.payload ?? {};
        const discriminator = e.event_type === "INDUSTRY_DOWNTURN" ? p.indicator : p.summary;
        return `${p.sector}:${e.event_type}:${discriminator}`;
      })
    );

    let conditionsFound = 0;

    // 3. Evaluate each sector present in the portfolio.
    for (const sector of sectors) {
      // --- Econ signals -> INDUSTRY_DOWNTURN ---
      const econSignals: RawEconSignal[] = DEMO_MODE
        ? await fetchSeedEconSignals(sector)
        : await econSource.fetch(sector, since);

      for (const signal of econSignals) {
        const config = getIndicatorsForSector(sector).find((c) => c.indicator === signal.indicator);
        if (!config) continue; // no known producer/consumer role for this indicator on this sector — skip rather than guess

        const normalized = normalizeChangePercent(signal.change_percent, config.role);
        const severity = downturnSeverity(normalized);
        if (!severity) continue; // not a material decline for this sector's exposure

        const fingerprint = `${sector}:INDUSTRY_DOWNTURN:${signal.indicator}`;
        if (emittedToday.has(fingerprint)) continue;

        const directionWord = config.role === "consumer" ? "input cost increase" : "decline";
        const summary = `${sector}: ${signal.indicator.replace(/_/g, " ")} shows a ${Math.abs(normalized).toFixed(1)}% ${directionWord} over the trailing ${signal.period_days} days (${signal.source_series}), sector-exposure-adjusted.`;

        try {
          await publishEvent({
            event_type:   "INDUSTRY_DOWNTURN",
            severity,
            scope:        "industry",
            source_agent: agent_name,
            run_id,
            title:        `${sector}: industry downturn signal (${signal.indicator.replace(/_/g, " ")})`,
            description:  summary,
            summary,
            payload: {
              severity_score:   severityToScore(severity),
              sector,
              indicator:        signal.indicator,
              change_percent:   normalized,
              period_days:      signal.period_days,
              source_series:    signal.source_series,
              summary,
            },
            is_demo: DEMO_MODE,
          });
          conditionsFound++;
        } catch (err) {
          console.error(`[industry-risk-agent] INDUSTRY_DOWNTURN publishEvent failed for ${sector}/${signal.indicator}:`, (err as Error).message);
        }
      }

      // --- News signals -> INDUSTRY_DISRUPTION ---
      const newsSignals: RawNewsSignal[] = DEMO_MODE
        ? await fetchSeedNewsSignals(sector)
        : await newsSource.fetch(sector, since);

      for (const signal of newsSignals) {
        if (!signal.url) {
          console.warn(`[industry-risk-agent] No url for ${sector} disruption "${signal.headline}" — skipping (evidence_url is required)`);
          continue;
        }

        const fingerprint = `${sector}:INDUSTRY_DISRUPTION:${signal.headline}`;
        if (emittedToday.has(fingerprint)) continue;

        const severity = disruptionSeverity(signal.disruption_type);
        const summary = `${sector}: ${signal.headline} (${signal.disruption_type.replace(/_/g, " ")}, via ${signal.source}, ${signal.published_date}).`;

        try {
          await publishEvent({
            event_type:   "INDUSTRY_DISRUPTION",
            severity,
            scope:        "industry",
            source_agent: agent_name,
            run_id,
            title:        `${sector}: ${signal.headline}`,
            description:  summary,
            summary,
            payload: {
              severity_score:   severityToScore(severity),
              sector,
              disruption_type:  signal.disruption_type,
              summary,
              evidence_url:     signal.url,
            },
            is_demo: DEMO_MODE,
          });
          conditionsFound++;
        } catch (err) {
          console.error(`[industry-risk-agent] INDUSTRY_DISRUPTION publishEvent failed for ${sector}:`, (err as Error).message);
        }
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned, // repurposed here: count of sectors scanned, not customers (this agent is sector-scoped)
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `Scanned ${scanned} sectors present in the portfolio. Emitted ${conditionsFound} industry-risk events.`,
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
