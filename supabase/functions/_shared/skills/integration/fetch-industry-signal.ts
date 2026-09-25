/**
 * @skill fetch-industry-signal
 * @type integration
 * @description Sector-scoped signal sources for the Industry Risk Monitor.
 *   Two independent sources, config-registered (not hardcoded) by the agent:
 *     FredBlsSource — econometric YoY series changes, feeds INDUSTRY_DOWNTURN.
 *       Enabled only when a FRED API key is configured.
 *     GdeltSource — news/events via GDELT's DOC 2.0 API, feeds
 *       INDUSTRY_DISRUPTION. Always enabled — GDELT's DOC API is public,
 *       no key required (verified live before building against it).
 *   Both return [] on any failure — never throw. Adding a new source:
 *   implement IndustrySignalSource only.
 * @usedBy industry-risk-agent
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIndicatorsForSector } from "../analytical/sector-exposure-direction.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndustryIndicator =
  | "production_output"
  | "producer_prices"
  | "employment"
  | "commodity_price"
  | "capacity_utilization";

export type DisruptionType =
  | "geopolitical"
  | "natural_disaster"
  | "labor"
  | "supply_chain"
  | "regulatory"
  | "technology"
  | "demand_shock"
  | "other";

export interface RawEconSignal {
  kind: "econ";
  sector: string;
  indicator: IndustryIndicator;
  source_series: string;
  change_percent: number; // raw, unsigned as the series itself reports it
  period_days: number;
  observation_date: string;
}

export interface RawNewsSignal {
  kind: "news";
  sector: string;
  headline: string;
  summary: string;
  url: string | null;
  source: string;
  published_date: string;
  disruption_type: DisruptionType;
}

export type RawSignal = RawEconSignal | RawNewsSignal;

export interface IndustrySignalSource {
  name: string;
  enabled: boolean;
  fetch(sector: string, since: Date): Promise<RawSignal[]>;
}

// ─── FredBlsSource ──────────────────────────────────────────────────────────

const FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations";
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export class FredBlsSource implements IndustrySignalSource {
  readonly name = "fred_bls";
  readonly enabled: boolean;

  constructor(private readonly apiKey: string | undefined) {
    this.enabled = !!apiKey;
  }

  async fetch(sector: string, _since: Date): Promise<RawEconSignal[]> {
    if (!this.enabled) return [];
    const configs = getIndicatorsForSector(sector);
    if (configs.length === 0) return [];

    const results: RawEconSignal[] = [];
    for (const cfg of configs) {
      try {
        const seriesId = cfg.source_series.replace(/^FRED:/, "");
        const url = `${FRED_OBSERVATIONS_URL}?series_id=${seriesId}&api_key=${this.apiKey}&file_type=json&sort_order=desc&limit=15`;
        const resp = await fetch(url);
        if (!resp.ok) continue;

        const data = await resp.json();
        const numeric = ((data.observations ?? []) as { date: string; value: string }[])
          .map((o) => ({ date: o.date, value: Number(o.value) }))
          .filter((o) => Number.isFinite(o.value));
        if (numeric.length < 2) continue;

        const latest = numeric[0];
        const latestTime = new Date(latest.date).getTime();

        // Find the observation closest to 365 days before the latest one (YoY,
        // pinned per docs/EVENT_TAXONOMY.md — matches how FRED/BLS report these).
        let prior = numeric[numeric.length - 1];
        let bestDiff = Infinity;
        for (const o of numeric) {
          const diff = Math.abs((latestTime - new Date(o.date).getTime()) - YEAR_MS);
          if (diff < bestDiff) {
            bestDiff = diff;
            prior = o;
          }
        }
        if (prior.value === 0) continue;

        const change_percent = Math.round(((latest.value - prior.value) / Math.abs(prior.value)) * 1000) / 10;

        results.push({
          kind: "econ",
          sector,
          indicator: cfg.indicator,
          source_series: cfg.source_series,
          change_percent,
          period_days: 365,
          observation_date: latest.date,
        });
      } catch {
        // one series failing is non-fatal — continue with the rest
      }
    }
    return results;
  }
}

// ─── GdeltSource ────────────────────────────────────────────────────────────

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

const SECTOR_QUERY_TERMS: Record<string, string> = {
  "Aerospace & Defense": "aerospace defense manufacturing",
  "Energy": "oil gas energy industry",
  "Industrial Manufacturing": "industrial manufacturing factory",
  "Materials": "steel metals materials industry",
  "Mining": "mining ore mine",
  "Transportation": "freight shipping transportation logistics",
};

const DISRUPTION_KEYWORDS: [string, DisruptionType][] = [
  ["sanction", "geopolitical"], ["tariff", "geopolitical"], ["export control", "geopolitical"], ["military conflict", "geopolitical"], ["invasion", "geopolitical"],
  ["flood", "natural_disaster"], ["earthquake", "natural_disaster"], ["hurricane", "natural_disaster"], ["wildfire", "natural_disaster"],
  ["strike", "labor"], ["labor union", "labor"], ["trade union", "labor"], ["walkout", "labor"], ["picket", "labor"],
  ["shortage", "supply_chain"], ["supply chain", "supply_chain"], ["bottleneck", "supply_chain"],
  ["regulation", "regulatory"], ["regulator", "regulatory"], ["permit", "regulatory"], ["compliance", "regulatory"],
  ["cyberattack", "technology"], ["outage", "technology"], ["automation", "technology"],
  ["demand", "demand_shock"], ["recession", "demand_shock"], ["slowdown", "demand_shock"],
];

export function classifyDisruptionType(title: string): DisruptionType {
  const lower = title.toLowerCase();
  for (const [keyword, type] of DISRUPTION_KEYWORDS) {
    if (lower.includes(keyword)) return type;
  }
  return "other";
}

function gdeltDateToIso(seendate: string): string {
  // GDELT format: YYYYMMDDTHHMMSSZ
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(seendate ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
}

export class GdeltSource implements IndustrySignalSource {
  readonly name = "gdelt";
  // GDELT's DOC 2.0 API is public and requires no key — verified live
  // (fred.stlouisfed.org requires a key; GDELT does not).
  readonly enabled = true;

  async fetch(sector: string, since: Date): Promise<RawNewsSignal[]> {
    const terms = SECTOR_QUERY_TERMS[sector];
    if (!terms) return [];

    const timespanDays = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86400000));
    const query = encodeURIComponent(
      `(${terms}) (disruption OR strike OR shortage OR sanctions OR flood OR regulation)`
    );
    const url = `${GDELT_DOC_URL}?query=${query}&mode=artlist&format=json&maxrecords=10&timespan=${timespanDays}d`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) return [];
      const data = await resp.json();
      const articles: Record<string, unknown>[] = data.articles ?? [];

      return articles.map((a) => {
        const title = (a.title as string) ?? "";
        return {
          kind: "news" as const,
          sector,
          headline: title,
          // GDELT's artlist mode returns metadata only (no article body/snippet) —
          // title stands in as the summary rather than fabricating content.
          summary: title,
          url: (a.url as string) ?? null,
          source: (a.domain as string) ?? "unknown",
          published_date: gdeltDateToIso(a.seendate as string),
          disruption_type: classifyDisruptionType(title),
        };
      });
    } catch {
      return [];
    }
  }
}

// ─── Seed fetch functions (demo mode) ───────────────────────────────────────

export async function fetchSeedEconSignals(sector: string): Promise<RawEconSignal[]> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return [];
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from("seed_industry_econ_signals")
      .select("sector, indicator, source_series, observation_date, change_percent, period_days")
      .eq("sector", sector);
    if (error || !data) return [];

    return data.map((row) => ({
      kind: "econ" as const,
      sector: row.sector,
      indicator: row.indicator as IndustryIndicator,
      source_series: row.source_series,
      change_percent: Number(row.change_percent),
      period_days: row.period_days,
      observation_date: row.observation_date,
    }));
  } catch {
    return [];
  }
}

export async function fetchSeedNewsSignals(sector: string): Promise<RawNewsSignal[]> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return [];
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from("seed_industry_news")
      .select("sector, headline, summary, url, source, published_date, disruption_type")
      .eq("sector", sector);
    if (error || !data) return [];

    return data.map((row) => ({
      kind: "news" as const,
      sector: row.sector,
      headline: row.headline,
      summary: row.summary,
      url: row.url,
      source: row.source,
      published_date: row.published_date,
      disruption_type: row.disruption_type as DisruptionType,
    }));
  } catch {
    return [];
  }
}
