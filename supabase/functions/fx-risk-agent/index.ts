/**
 * FX Risk Agent — supabase/functions/fx-risk-agent/index.ts
 *
 * Pure signal agent — emits credit_events via publishEvent only; never writes
 * pending_actions. Credit-risk lens, not treasury: no hedge sizing, no hedge advice.
 *
 * scope='currency', customer_id always null. Seller is US-based (USD costs), so only
 * non-USD receivables carry exposure, and only a weakening foreign currency hurts.
 *
 * Signals:
 *   FX_EXPOSURE_FLAG    — large UNHEDGED non-USD exposure (size alone fires; an adverse
 *                         move and a long exposure window escalate severity)
 *   CURRENCY_VOLATILITY — material 30-day move in a currency the portfolio is exposed to
 *                         (favourable moves are info-only)
 * Thresholds come from FX_POLICY_DEFAULTS (later: company_settings).
 *
 * Data boundary: DEMO_MODE ? seed_fx_rates : fetchLiveFxRates() (FMP, unverified).
 * Rate limit 60 min; DEMO_MODE self-resets this agent's demo credit_events;
 * dedup against credit_events (today, currency:type) plus a live volatility cooldown.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";
import {
  changeOverDaysPct,
  evaluateCurrencyVolatility,
  evaluateFxExposureFlag,
  FX_POLICY_DEFAULTS,
  realisedVolPct,
  type RatePoint,
} from "../_shared/skills/analytical/analyse-fx-exposure.ts";
import { fetchLiveFxRates, fetchSeedFxRates, type FxSeries } from "../_shared/skills/integration/fetch-fx-rates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const policy = FX_POLICY_DEFAULTS;

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
  const agent_name = "fx_risk_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns, error: recentRunsError } = await supabase
    .from("agent_runs")
    .select("id, started_at, status")
    .eq("agent_name", agent_name)
    .gte("started_at", cutoff)
    .in("status", ["completed", "running"])
    .limit(1);
  if (recentRunsError) console.error("[fx-risk-agent] agent_runs query failed:", recentRunsError.message);

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
    if (resetError) console.error("[fx-risk-agent] demo reset failed:", JSON.stringify(resetError));
  }

  try {
    const now = new Date();

    // 1. Currencies with outstanding non-USD receivables.
    const { data: invCur, error: invCurError } = await supabase
      .from("invoices").select("currency")
      .eq("is_demo", DEMO_MODE).gt("outstanding_amount", 0);
    if (invCurError) throw invCurError;
    const currencies = [...new Set((invCur ?? [])
      .map((r: any) => String(r.currency ?? "USD").toUpperCase())
      .filter((c: string) => c !== "USD" && c.length === 3))];

    // 2. Fetch boundary: the ONLY place DEMO_MODE branches.
    const series: FxSeries = DEMO_MODE
      ? await fetchSeedFxRates(supabase, currencies)
      : await fetchLiveFxRates(currencies);
    const source = DEMO_MODE ? "seed" : "fmp";

    // 3. Persist history + per-currency status.
    if (DEMO_MODE) {
      const { error } = await supabase.from("fx_rate_history").delete().eq("source", "seed");
      if (error) console.error("[fx-risk-agent] seed history cleanup failed:", JSON.stringify(error));
    }
    const stats = new Map<string, { rate: number; change5: number | null; change30: number | null; vol: number | null }>();
    for (const cur of Object.keys(series)) {
      const pts: RatePoint[] = series[cur];
      if (pts.length === 0) continue;
      const rows = pts.map((p) => ({ currency: cur, rate_date: p.date, rate: p.rate, source }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("fx_rate_history").upsert(rows.slice(i, i + 500), { onConflict: "currency,rate_date" });
        if (error) throw error;
      }
      const latest = pts[pts.length - 1];
      const st = {
        rate: latest.rate,
        change5: changeOverDaysPct(pts, 5),
        change30: changeOverDaysPct(pts, policy.VOL_WINDOW_DAYS),
        vol: realisedVolPct(pts, policy.VOL_WINDOW_DAYS),
      };
      stats.set(cur, st);
      const { error } = await supabase.from("fx_currency_status").upsert({
        currency: cur, rate: latest.rate, rate_date: latest.date,
        change_5d_pct: st.change5, change_30d_pct: st.change30, volatility_pct: st.vol,
        source, as_of: new Date().toISOString(),
      }, { onConflict: "currency" });
      if (error) throw error;
    }

    // 4. Exposure per invoice (view joins booking vs current rate).
    const { data: invRows, error: viewError } = await supabase
      .from("v_fx_exposure_by_invoice").select("*").eq("is_demo", DEMO_MODE);
    if (viewError) throw viewError;

    const { data: custRows, error: custError } = await supabase
      .from("customers").select("current_exposure").gt("current_exposure", 0);
    if (custError) throw custError;
    const totalPortfolio = (custRows ?? []).reduce((s: number, c: any) => s + Number(c.current_exposure ?? 0), 0);

    // 5. Dedup.
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data: already, error: alreadyError } = await supabase
      .from("credit_events").select("event_type, payload, created_at")
      .eq("source_agent", agent_name).eq("is_demo", DEMO_MODE)
      .gte("created_at", new Date(now.getTime() - policy.COOLDOWN_DAYS * 86_400_000).toISOString());
    if (alreadyError) console.error("[fx-risk-agent] dedup pre-fetch failed:", JSON.stringify(alreadyError));
    const emittedToday = new Set<string>();
    const volRecent = new Set<string>();
    for (const e of already ?? []) {
      const cur = (e as any).payload?.currency_code;
      if ((e as any).created_at >= todayStart) emittedToday.add(`${cur}:${(e as any).event_type}`);
      if ((e as any).event_type === "CURRENCY_VOLATILITY") volRecent.add(String(cur));
    }

    let conditionsFound = 0;
    const emit = async (
      key: string, event_type: string, severity: any, title: string, summary: string, payload: Record<string, unknown>,
    ) => {
      if (emittedToday.has(key)) return;
      try {
        await publishEvent({
          event_type: event_type as any, severity, scope: "currency", customer_id: null,
          source_agent: agent_name, run_id, title, description: summary, summary,
          payload: { severity_score: severityToScore(severity), ...payload, summary },
          is_demo: DEMO_MODE,
        } as any);
        conditionsFound++;
      } catch (err) {
        console.error(`[fx-risk-agent] ${event_type} publishEvent failed for ${key}:`, (err as Error).message);
      }
    };

    // 6. Aggregate per currency and evaluate.
    let scanned = 0;
    for (const cur of currencies) {
      const rows = (invRows ?? []).filter((r: any) => r.currency === cur);
      if (rows.length === 0) continue;
      scanned++;
      const st = stats.get(cur);
      const unhedged = rows.filter((r: any) => !r.fx_hedged);
      const hedged = rows.filter((r: any) => r.fx_hedged);
      const sum = (a: any[], f: (r: any) => number) => a.reduce((s, r) => s + f(r), 0);
      const unhedgedUsd = sum(unhedged, (r) => Number(r.usd_at_booking));
      const hedgedUsd = sum(hedged, (r) => Number(r.usd_at_booking));
      const unhedgedNow = sum(unhedged, (r) => Number(r.usd_now));
      const fxDelta = sum(unhedged, (r) => Number(r.fx_delta_usd));
      const sens = sum(unhedged, (r) => Number(r.sensitivity_10pct_usd));
      const valueChange = unhedgedUsd > 0 ? (unhedgedNow / unhedgedUsd - 1) * 100 : 0;
      const avgWindow = unhedgedUsd > 0
        ? sum(unhedged, (r) => Number(r.window_days) * Number(r.usd_at_booking)) / unhedgedUsd
        : 0;

      const byCust = new Map<string, { customer_id: string; company_name: string; unhedged_usd: number }>();
      for (const r of unhedged) {
        const e = byCust.get(r.customer_id) ?? { customer_id: r.customer_id, company_name: r.company_name, unhedged_usd: 0 };
        e.unhedged_usd += Number(r.usd_at_booking);
        byCust.set(r.customer_id, e);
      }
      const top = [...byCust.values()].sort((a, b) => b.unhedged_usd - a.unhedged_usd).slice(0, 3)
        .map((c) => ({ ...c, unhedged_usd: Math.round(c.unhedged_usd) }));

      const flag = evaluateFxExposureFlag({
        currency: cur, unhedged_usd: unhedgedUsd, hedged_usd: hedgedUsd,
        total_portfolio_exposure_usd: totalPortfolio, unhedged_value_change_pct: valueChange, avg_window_days: avgWindow,
      }, st?.change30 ?? null, policy);

      if (flag) {
        await emit(`${cur}:FX_EXPOSURE_FLAG`, "FX_EXPOSURE_FLAG", flag.severity,
          `${cur}: ${usd(unhedgedUsd)} unhedged receivables${flag.adverse ? " and weakening" : ""}`,
          flag.reason, {
            currency_code: cur,
            total_exposure_usd: Math.round(unhedgedUsd + hedgedUsd),
            customers_affected: byCust.size,
            reason: flag.reason,
            unhedged_exposure_usd: Math.round(unhedgedUsd),
            hedged_exposure_usd: Math.round(hedgedUsd),
            share_of_portfolio_pct: Number(flag.share_of_portfolio_pct.toFixed(1)),
            fx_delta_usd: Math.round(fxDelta),
            sensitivity_10pct_usd: Math.round(sens),
            avg_window_days: Math.round(avgWindow),
            adverse_move_pct: Number((st?.change30 ?? valueChange).toFixed(1)),
            policy_breach: false,
            top_customers: top,
          });
      }

      const vol = evaluateCurrencyVolatility(st?.change30 ?? null, st?.vol ?? null, unhedgedUsd + hedgedUsd, policy);
      if (vol && !(DEMO_MODE === false && volRecent.has(cur))) {
        const word = vol.direction === "adverse" ? "weakened" : "strengthened";
        const summary = `${cur} has ${word} ${Math.abs(vol.change_30d_pct).toFixed(1)}% against USD over 30 days` +
          (vol.volatility_pct !== null ? ` (realised volatility ${vol.volatility_pct.toFixed(1)}% annualised)` : "") +
          `. Portfolio receivables in ${cur}: ${usd(unhedgedUsd + hedgedUsd)}` +
          (vol.direction === "adverse" ? `, of which ${usd(unhedgedUsd)} unhedged.` : ".");
        await emit(`${cur}:CURRENCY_VOLATILITY`, "CURRENCY_VOLATILITY", vol.severity,
          `${cur} ${word} ${Math.abs(vol.change_30d_pct).toFixed(1)}% vs USD (30d)`, summary, {
            currency_code: cur,
            volatility_percent: Number((vol.volatility_pct ?? 0).toFixed(1)),
            period_days: policy.VOL_WINDOW_DAYS,
            direction: vol.direction,
            change_30d_pct: Number(vol.change_30d_pct.toFixed(1)),
            exposure_usd: Math.round(unhedgedUsd + hedgedUsd),
          });
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned, // repurposed: currencies scanned
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `Scanned ${scanned} currencies with outstanding receivables. Emitted ${conditionsFound} FX events.`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ run_id, status: "completed", currencies_scanned: scanned, events: conditionsFound }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
