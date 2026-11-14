/**
 * @skill trade-credit-monitor
 * @type integration
 * @description Trade Credit Monitor connector (github.com/larsewallin/trade-credit-monitor, MIT;
 *   API in its docs/API.md). Trade-credit stories tagged by category, country, sector,
 *   company and severity: insolvency notices (UK Gazette), late payments, country risk.
 *   Tags come from keyword rules or AI and can be wrong, so everything here is a signal
 *   with its source link, never a fact on its own.
 *
 *   TCM_API_URL sets the address (default: the hosted copy; "off" switches it off; a local
 *   copy runs with `npm run dev` on port 3000). Never throws: a failure returns [].
 * @usedBy news-monitor-agent (TradeCreditMonitorProvider), country-risk-agent (live country signals)
 */
import type { NewsProvider, RawArticle } from "./search-news.ts";

export const DEFAULT_TCM_URL = "https://trade-credit-monitor.vercel.app";

export interface TcmArticle {
  id: string; title: string; url: string; source: string; sourceKind: "news" | "publisher" | "official"; feed: string;
  publishedAt: string; snippet?: string; categories: string[]; primaryCategory: string;
  countries: string[]; sectors: string[]; companies: string[]; severity: number; relevance: number; summary?: string;
}

export interface TcmQuery { category?: string; country?: string; sector?: string; company?: string; minSeverity?: number; hours?: number; limit?: number }

export function tcmBase(env: (k: string) => string | undefined): string | null {
  const v = (env("TCM_API_URL") ?? "").trim();
  if (v.toLowerCase() === "off") return null;
  return (v || DEFAULT_TCM_URL).replace(/\/$/, "");
}

export function tradeCreditMonitor(base: string, deps: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const f = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 20_000;
  return {
    async news(q: TcmQuery): Promise<TcmArticle[]> {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await f(`${base}/api/news?${p}`, { headers: { accept: "application/json" }, signal: ctrl.signal });
        if (!r.ok) return [];
        const j = await r.json() as { articles?: TcmArticle[] };
        return Array.isArray(j.articles) ? j.articles : [];
      } catch { return []; }
      finally { clearTimeout(t); }
    },
  };
}

/** Company name for matching: upper case, punctuation and legal suffixes removed. */
export function simpleName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(LIMITED|LTD|PLC|LLC|LLP|INC|CORP|CORPORATION|CO|COMPANY|GMBH|AG|SA|SAS|BV|NV|SPA|AB|AS|OY|GROUP|HOLDINGS?)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

/**
 * News provider for the News agent: stories that name the customer (company tag equal
 * after normalising, or the full name in the title). A shared word is not enough: "Ford"
 * never matches "Fordham Ltd".
 */
export class TradeCreditMonitorProvider implements NewsProvider {
  name = "trade_credit_monitor";
  constructor(private base: string, private deps: { fetch?: typeof fetch } = {}) {}
  async search(companyName: string, _ticker?: string, daysBack = 7, maxResults = 10): Promise<RawArticle[]> {
    const want = simpleName(companyName);
    if (want.length < 3) return [];
    const client = tradeCreditMonitor(this.base, this.deps);
    const items = await client.news({ q: companyName, hours: daysBack * 24, limit: 50 } as TcmQuery & { q: string });
    const titleRe = new RegExp(`(^|[^A-Z0-9])${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[^A-Z0-9]+")}([^A-Z0-9]|$)`);
    return items
      .filter((a) => a.companies.some((c) => simpleName(c) === want) || titleRe.test(a.title.toUpperCase()))
      .slice(0, maxResults)
      .map((a) => ({
        headline: a.title,
        summary: a.summary ?? a.snippet ?? "",
        url: a.url || null,
        source: a.source,
        published_date: a.publishedAt,
        relevance_score: Math.max(0, Math.min(1, a.relevance)),
        provider: "trade_credit_monitor",
      }));
  }
}

const POLITICAL: [RegExp, "election" | "unrest" | "sanctions" | "capital_controls"][] = [
  [/sanction|export control|embargo|blacklist/i, "sanctions"],
  [/capital control|currency control|exchange control|repatriat/i, "capital_controls"],
  [/protest|unrest|riot|coup|strike|conflict|war\b|violence|martial/i, "unrest"],
  [/election|vote|referendum|government collapse|parliament/i, "election"],
];
const ECONOMIC: [RegExp, "currency_crisis" | "recession" | "inflation" | "banking_crisis"][] = [
  [/devaluat|currency (crisis|collapse|plunge)|peg|depreciat/i, "currency_crisis"],
  [/bank (run|failure|collapse)|banking crisis|deposit freeze/i, "banking_crisis"],
  [/hyperinflation|inflation (surge|soar|spike)|price spiral/i, "inflation"],
  [/recession|contraction|gdp (fall|drop|shrink)|default on (its )?(sovereign )?debt|sovereign default/i, "recession"],
];

export interface CountrySignal {
  event_type: "COUNTRY_POLITICAL_RISK" | "COUNTRY_ECONOMIC_SHOCK";
  kind: string;
  severity: "medium" | "high";
  article: TcmArticle;
}

/**
 * The strongest country-risk story per country and signal type: economic wording → economic
 * shock, otherwise a political-risk signal. Severity 4 → medium, 5 → high; below 4 nothing.
 */
export function countrySignals(country: string, items: TcmArticle[]): CountrySignal[] {
  const best = new Map<string, CountrySignal>();
  for (const a of items) {
    if (a.severity < 4 || !a.countries.includes(country)) continue;
    const text = `${a.title} ${a.summary ?? ""}`;
    const eco = ECONOMIC.find(([re]) => re.test(text));
    const pol = POLITICAL.find(([re]) => re.test(text));
    const sig: CountrySignal = eco
      ? { event_type: "COUNTRY_ECONOMIC_SHOCK", kind: eco[1], severity: a.severity >= 5 ? "high" : "medium", article: a }
      : { event_type: "COUNTRY_POLITICAL_RISK", kind: pol ? pol[1] : "other", severity: a.severity >= 5 ? "high" : "medium", article: a };
    const prev = best.get(sig.event_type);
    if (!prev || a.severity > prev.article.severity || (a.severity === prev.article.severity && a.publishedAt > prev.article.publishedAt)) best.set(sig.event_type, sig);
  }
  return [...best.values()];
}
