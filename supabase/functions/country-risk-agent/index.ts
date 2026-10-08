/**
 * Country Risk Monitor Agent — supabase/functions/country-risk-agent/index.ts
 *
 * Pure signal agent — emits credit_events via publishEvent only; never writes
 * pending_actions (CIA owns those; country events have customer_id null and are
 * the on-ramp for the future Risk Agent).
 *
 * scope='country', customer_id always null. Only countries with exposure
 * (customers.country_code, current_exposure > 0) are evaluated.
 *
 * Signals (each with its own firing rule):
 *   COUNTRY_RATING_CHANGE   — sovereign rating differs from previous
 *   COUNTRY_POLITICAL_RISK  — political score dropped >= 10 points
 *   COUNTRY_ECONOMIC_SHOCK  — economic score dropped >= 10 points
 *   INTEREST_RATE_CHANGE    — policy rate moved >= 25 bp
 *   TARIFF_CHANGE           — tariff change seeded for the country (non-null)
 * Each payload's summary includes the USD exposure in that country.
 *
 * Data boundary: DEMO_MODE ? seed_country_risk : fetchLiveCountryRisk() (STUB —
 * no licensed live source chosen yet; returns []).
 *
 * Rate limit 60 min; DEMO_MODE self-resets this agent's demo credit_events;
 * dedup against credit_events (today, fingerprint country:type).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const SCORE_DROP_THRESHOLD = 10;
const RATE_CHANGE_THRESHOLD_BP = 25;

type Sev = "info" | "low" | "medium" | "high" | "critical";

interface CountryRow {
  country_code: string;
  country_name: string;
  central_bank: string;
  political_score: number;
  previous_political_score: number;
  political_risk_type: string;
  political_summary: string | null;
  economic_score: number;
  previous_economic_score: number;
  economic_shock_type: string;
  economic_summary: string | null;
  rating_agency: string;
  previous_rating: string;
  current_rating: string;
  rating_outlook: string;
  rating_effective_date: string;
  policy_rate: number;
  previous_policy_rate: number;
  rate_effective_date: string;
  tariff_change_percent: number | null;
  tariff_affected_countries: string[] | null;
  tariff_affected_sectors: string[] | null;
  tariff_effective_date: string | null;
  tariff_summary: string | null;
  evidence_url: string;
}

// LIVE STUB: no licensed live country-risk source chosen yet (OECD/Credendo/Allianz
// have no confirmed API or reuse terms). Swap this single function when one is picked.
async function fetchLiveCountryRisk(_codes: string[]): Promise<CountryRow[]> {
  return [];
}

function dropSeverity(drop: number): Sev | null {
  if (drop < SCORE_DROP_THRESHOLD) return null;
  if (drop >= 30) return "critical";
  if (drop >= 20) return "high";
  return "medium";
}

function ratingSeverity(outlook: string, downgrade: boolean): Sev {
  if (!downgrade) return "info";
  return outlook === "negative" || outlook === "watch" ? "high" : "medium";
}

function rateSeverity(bp: number): Sev | null {
  const a = Math.abs(bp);
  if (a < RATE_CHANGE_THRESHOLD_BP) return null;
  if (a >= 100) return "high";
  if (a >= 50) return "medium";
  return "low";
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "country_risk_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns, error: recentRunsError } = await supabase
    .from("agent_runs")
    .select("id, started_at, status")
    .eq("agent_name", agent_name)
    .gte("started_at", cutoff)
    .in("status", ["completed", "running"])
    .limit(1);
  if (recentRunsError) console.error("[country-risk-agent] agent_runs query failed:", recentRunsError.message);

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
    if (resetError) console.error("[country-risk-agent] demo reset failed:", JSON.stringify(resetError));
  }

  try {
    const now = new Date();

    // 1. Exposure by country (portfolio only).
    const { data: custRows, error: custError } = await supabase
      .from("customers").select("country_code, current_exposure").gt("current_exposure", 0);
    if (custError) {
      console.error("[country-risk-agent] customers query failed:", JSON.stringify(custError));
      throw custError;
    }
    const exposure = new Map<string, number>();
    for (const c of custRows ?? []) {
      if (!c.country_code) continue;
      exposure.set(c.country_code, (exposure.get(c.country_code) ?? 0) + Number(c.current_exposure ?? 0));
    }
    const codes = [...exposure.keys()];

    // 2. Fetch boundary: the ONLY place DEMO_MODE branches.
    let rows: CountryRow[] = [];
    if (DEMO_MODE) {
      const { data, error } = await supabase.from("seed_country_risk").select("*");
      if (error) {
        console.error("[country-risk-agent] seed_country_risk query failed:", JSON.stringify(error));
        throw error;
      }
      rows = (data ?? []) as CountryRow[];
    } else {
      rows = await fetchLiveCountryRisk(codes);
    }

    // Tariffs are relevant if the issuing country OR any affected country is in the portfolio.
    const countriesInPortfolio = new Set(codes);
    const exposureFor = (c: string) => exposure.get(c) ?? 0;

    // 3. Dedup against today's emitted events.
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data: already, error: alreadyError } = await supabase
      .from("credit_events").select("event_type, payload")
      .eq("source_agent", agent_name).eq("is_demo", DEMO_MODE).gte("created_at", todayStart);
    if (alreadyError) console.error("[country-risk-agent] dedup pre-fetch failed:", JSON.stringify(alreadyError));
    const emitted = new Set((already ?? []).map((e: any) => `${e.payload?.country_code ?? e.payload?.origin_country}:${e.event_type}`));

    let conditionsFound = 0;
    let scanned = 0;

    const emit = async (
      key: string, event_type: string, severity: Sev, title: string, summary: string, payload: Record<string, unknown>,
    ) => {
      if (emitted.has(key)) return;
      try {
        await publishEvent({
          event_type: event_type as any, severity, scope: "country", source_agent: agent_name, run_id,
          title, description: summary, summary,
          payload: { severity_score: severityToScore(severity), ...payload, summary },
          is_demo: DEMO_MODE,
        } as any);
        conditionsFound++;
      } catch (err) {
        console.error(`[country-risk-agent] ${event_type} publishEvent failed for ${key}:`, (err as Error).message);
      }
    };

    for (const r of rows) {
      const exp = exposureFor(r.country_code);
      const inPortfolio = countriesInPortfolio.has(r.country_code);
      const tariffRelevant = r.tariff_change_percent != null &&
        (inPortfolio || (r.tariff_affected_countries ?? []).some((c) => countriesInPortfolio.has(c)));
      if (!inPortfolio && !tariffRelevant) continue;
      scanned++;
      const expText = exp > 0 ? ` Portfolio exposure in ${r.country_code}: ${usd(exp)}.` : "";

      if (inPortfolio) {
        // Rating change
        if (r.current_rating !== r.previous_rating) {
          const down = isDowngrade(r.previous_rating, r.current_rating);
          const sev = ratingSeverity(r.rating_outlook, down);
          const summary = `${r.country_name}: sovereign rating ${r.previous_rating} → ${r.current_rating} (${r.rating_agency.toUpperCase()}, outlook ${r.rating_outlook}).${expText}`;
          await emit(`${r.country_code}:COUNTRY_RATING_CHANGE`, "COUNTRY_RATING_CHANGE", sev,
            `${r.country_name}: sovereign rating ${down ? "downgraded" : "changed"} to ${r.current_rating}`, summary, {
              country_code: r.country_code, country_name: r.country_name, agency: r.rating_agency,
              old_rating: r.previous_rating, new_rating: r.current_rating, outlook: r.rating_outlook,
              effective_date: r.rating_effective_date, exposure_usd: exp,
            });
        }

        // Political risk
        const polSev = dropSeverity(r.previous_political_score - r.political_score);
        if (polSev) {
          const summary = `${r.country_name}: ${r.political_summary ?? "political risk has increased"} (score ${r.previous_political_score} → ${r.political_score}).${expText}`;
          await emit(`${r.country_code}:COUNTRY_POLITICAL_RISK`, "COUNTRY_POLITICAL_RISK", polSev,
            `${r.country_name}: political risk rising`, summary, {
              country_code: r.country_code, risk_type: r.political_risk_type, evidence_url: r.evidence_url, exposure_usd: exp,
            });
        }

        // Economic shock
        const ecoSev = dropSeverity(r.previous_economic_score - r.economic_score);
        if (ecoSev) {
          const summary = `${r.country_name}: ${r.economic_summary ?? "economic conditions have deteriorated"} (score ${r.previous_economic_score} → ${r.economic_score}).${expText}`;
          await emit(`${r.country_code}:COUNTRY_ECONOMIC_SHOCK`, "COUNTRY_ECONOMIC_SHOCK", ecoSev,
            `${r.country_name}: economic shock`, summary, {
              country_code: r.country_code, shock_type: r.economic_shock_type, evidence_url: r.evidence_url, exposure_usd: exp,
            });
        }

        // Interest rate
        const bp = Math.round((Number(r.policy_rate) - Number(r.previous_policy_rate)) * 100);
        const rateSev = rateSeverity(bp);
        if (rateSev) {
          const summary = `${r.central_bank} ${bp > 0 ? "raised" : "cut"} its policy rate by ${Math.abs(bp)} bp to ${Number(r.policy_rate).toFixed(2)}% (from ${Number(r.previous_policy_rate).toFixed(2)}%).${expText}`;
          await emit(`${r.country_code}:INTEREST_RATE_CHANGE`, "INTEREST_RATE_CHANGE", rateSev,
            `${r.country_name}: policy rate ${bp > 0 ? "hike" : "cut"} (${Math.abs(bp)} bp)`, summary, {
              country_code: r.country_code, central_bank: r.central_bank,
              old_rate_percent: Number(r.previous_policy_rate), new_rate_percent: Number(r.policy_rate),
              effective_date: r.rate_effective_date, exposure_usd: exp,
            });
        }
      }

      // Tariff change
      if (tariffRelevant) {
        const pct = Number(r.tariff_change_percent);
        const sev: Sev = Math.abs(pct) >= 25 ? "high" : Math.abs(pct) >= 10 ? "medium" : "low";
        const summary = `${r.country_name}: ${r.tariff_summary ?? `${pct}% tariff change`} Effective ${r.tariff_effective_date}.${expText}`;
        await emit(`${r.country_code}:TARIFF_CHANGE`, "TARIFF_CHANGE", sev,
          `${r.country_name}: ${pct > 0 ? "+" : ""}${pct}% tariff change`, summary, {
            origin_country: r.country_code, tariff_change_percent: pct,
            affected_countries: r.tariff_affected_countries ?? [], affected_sectors: r.tariff_affected_sectors ?? [],
            effective_date: r.tariff_effective_date, exposure_usd: exp,
          });
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned, // repurposed: countries scanned
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `Scanned ${scanned} countries relevant to the portfolio. Emitted ${conditionsFound} country-risk events.`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ run_id, status: "completed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await supabase.from("agent_runs").update({
      status: "failed", completed_at: new Date().toISOString(), summary: `Error: ${(err as Error).message}`,
    }).eq("id", run_id);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Ordered best → worst (S&P/Fitch style, Moody's mapped alongside).
const SCALE = ["AAA","Aaa","AA+","Aa1","AA","Aa2","AA-","Aa3","A+","A1","A","A2","A-","A3","BBB+","Baa1","BBB","Baa2","BBB-","Baa3",
  "BB+","Ba1","BB","Ba2","BB-","Ba3","B+","B1","B","B2","B-","B3","CCC","Caa","CC","C","D"];
function isDowngrade(prev: string, cur: string): boolean {
  const p = SCALE.indexOf(prev), c = SCALE.indexOf(cur);
  return p >= 0 && c >= 0 ? c > p : false;
}
