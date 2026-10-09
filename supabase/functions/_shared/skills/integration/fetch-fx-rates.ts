/**
 * @skill fetch-fx-rates
 * @type integration
 * @description Daily FX rate history for the FX Risk agent. Rates are expressed as
 *   units of foreign currency per 1 USD (rising = currency weakened).
 *   Seed source (DEMO_MODE): seed_fx_rates (days_ago -> date).
 *   Live source: Financial Modeling Prep historical EOD (UNVERIFIED endpoint/params;
 *   needs FMP_API_KEY). Returns [] on any failure, never throws.
 * @usedBy fx-risk-agent
 */

import type { RatePoint } from "../analytical/analyse-fx-exposure.ts";

export type FxSeries = Record<string, RatePoint[]>;

function isoDaysAgo(days: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// deno-lint-ignore no-explicit-any
export async function fetchSeedFxRates(supabase: any, currencies: string[]): Promise<FxSeries> {
  const out: FxSeries = {};
  if (currencies.length === 0) return out;
  const { data, error } = await supabase
    .from("seed_fx_rates").select("currency, days_ago, rate").in("currency", currencies);
  if (error) {
    console.error("[fetch-fx-rates] seed query failed:", JSON.stringify(error));
    return out;
  }
  for (const r of data ?? []) {
    (out[r.currency] ??= []).push({ date: isoDaysAgo(Number(r.days_ago)), rate: Number(r.rate) });
  }
  for (const c of Object.keys(out)) out[c].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

export async function fetchLiveFxRates(currencies: string[], historyDays = 180): Promise<FxSeries> {
  const out: FxSeries = {};
  const key = Deno.env.get("FMP_API_KEY");
  if (!key) {
    console.warn("[fetch-fx-rates] FMP_API_KEY not set; live FX rates unavailable");
    return out;
  }
  const from = isoDaysAgo(historyDays);
  const to = isoDaysAgo(0);
  for (const cur of currencies) {
    try {
      const url = `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${cur}USD&from=${from}&to=${to}&apikey=${key}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[fetch-fx-rates] FMP ${cur} HTTP ${res.status}`);
        continue;
      }
      const body = await res.json();
      const rows: any[] = Array.isArray(body) ? body : (body?.historical ?? []);
      const pts: RatePoint[] = [];
      for (const r of rows) {
        const price = Number(r.price ?? r.close);
        if (r.date && price > 0) pts.push({ date: String(r.date).slice(0, 10), rate: 1 / price });
      }
      pts.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (pts.length) out[cur] = pts;
    } catch (err) {
      console.error(`[fetch-fx-rates] FMP ${cur} failed:`, (err as Error).message);
    }
  }
  return out;
}
