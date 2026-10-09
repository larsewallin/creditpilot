/**
 * @skill correlate-macro-exposure
 * @type analytical
 * @description Pure logic for the Risk Agent. Maps customer-less (macro) credit events from the
 *   Country, Industry and FX agents onto the customers they actually touch, and flags customers
 *   where adverse signals converge across 2+ DIFFERENT dimensions (country, industry, currency).
 *   One dimension alone is not flagged here (it already shows on its own page); convergence is the
 *   point. Currency counts only if the customer holds UNHEDGED invoices in that currency.
 *   A signal counts only at HIGH severity or above (MACRO_MIN_SEVERITY); medium signals are shown on
 *   their own pages but are too common to be evidence of convergence. A tariff applies to the
 *   countries it affects, not to the country imposing it.
 *   Counts only macro-derived signals, never the customer's own events, so the Risk Agent does not
 *   double count what CIA already sees. CIA does the corroboration with customer-level signals.
 * @usedBy risk-agent
 */

export type Sev = "info" | "low" | "medium" | "high" | "critical";
export type Dimension = "country" | "industry" | "currency";

export interface MacroEvent {
  id: string;
  event_type: string;
  severity: Sev;
  title?: string | null;
  summary?: string | null;
  payload: Record<string, any> | null;
}

export interface MacroCustomer {
  id: string;
  company_name: string;
  country_code: string | null;
  sector: string | null;
  current_exposure: number;
}

export const DEFAULT_ADVERSE_FX_MOVE_PCT = 3;
/** Named config (later: company settings). */
export const MACRO_MIN_SEVERITY: Sev = "high";

const COUNTRY_TYPES = new Set([
  "COUNTRY_RATING_CHANGE", "COUNTRY_POLITICAL_RISK", "COUNTRY_ECONOMIC_SHOCK", "INTEREST_RATE_CHANGE", "TARIFF_CHANGE",
]);
const INDUSTRY_TYPES = new Set(["INDUSTRY_DOWNTURN", "INDUSTRY_DISRUPTION"]);
const CURRENCY_TYPES = new Set(["FX_EXPOSURE_FLAG", "CURRENCY_VOLATILITY"]);

const RANK: Record<Sev, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const SCORE: Record<Sev, number> = { info: 7, low: 27, medium: 52, high: 75, critical: 92 };
const LEVELS: Sev[] = ["info", "low", "medium", "high", "critical"];

export function dimensionOf(eventType: string): Dimension | null {
  if (COUNTRY_TYPES.has(eventType)) return "country";
  if (INDUSTRY_TYPES.has(eventType)) return "industry";
  if (CURRENCY_TYPES.has(eventType)) return "currency";
  return null;
}

/** An event counts as an adverse macro signal: high+ severity, and not a favourable / non-adverse FX item. */
export function isAdverse(evt: MacroEvent, adverseFxMovePct = DEFAULT_ADVERSE_FX_MOVE_PCT): boolean {
  if (dimensionOf(evt.event_type) === null) return false;
  if (RANK[evt.severity] < RANK[MACRO_MIN_SEVERITY]) return false;
  const p = evt.payload ?? {};
  if (evt.event_type === "CURRENCY_VOLATILITY" && p.direction === "favourable") return false;
  if (evt.event_type === "FX_EXPOSURE_FLAG") {
    const move = Number(p.adverse_move_pct);
    if (!Number.isFinite(move) || move > -adverseFxMovePct) return false;
  }
  return true;
}

/** Keys an event applies to: ISO country codes, sector names or currency codes. */
export function eventKeys(evt: MacroEvent): string[] {
  const p = evt.payload ?? {};
  const dim = dimensionOf(evt.event_type);
  if (dim === "country") {
    const keys = new Set<string>();
    const list = evt.event_type === "TARIFF_CHANGE"
      ? (Array.isArray(p.affected_countries) ? p.affected_countries : [])
      : [p.country_code, ...(Array.isArray(p.affected_countries) ? p.affected_countries : [])];
    for (const c of list) {
      if (typeof c === "string" && c.length === 2) keys.add(c.toUpperCase());
    }
    return [...keys];
  }
  if (dim === "industry") return typeof p.sector === "string" ? [p.sector] : [];
  if (dim === "currency") return typeof p.currency_code === "string" ? [p.currency_code.toUpperCase()] : [];
  return [];
}

export interface Component {
  dimension: Dimension;
  key: string;
  event_id: string;
  event_type: string;
  severity: Sev;
  text: string;
}

export interface CustomerMacroResult {
  customer_id: string;
  company_name: string;
  dimensions: Dimension[];
  components: Component[];
  severity: Sev;
  risk_score: number;
  exposure_usd: number;
}

function bump(s: Sev, steps: number, cap: Sev): Sev {
  return LEVELS[Math.min(RANK[s] + steps, RANK[cap])];
}

/**
 * unhedgedByCurrency: this customer's unhedged USD exposure per currency (from v_fx_exposure_by_invoice).
 * Returns null unless adverse signals converge across 2+ distinct dimensions.
 */
export function correlateCustomer(
  customer: MacroCustomer,
  events: MacroEvent[],
  unhedgedByCurrency: Record<string, number>,
  adverseFxMovePct = DEFAULT_ADVERSE_FX_MOVE_PCT,
): CustomerMacroResult | null {
  const components: Component[] = [];
  for (const evt of events) {
    if (!isAdverse(evt, adverseFxMovePct)) continue;
    const dim = dimensionOf(evt.event_type)!;
    for (const key of eventKeys(evt)) {
      const applies =
        (dim === "country" && customer.country_code?.toUpperCase() === key) ||
        (dim === "industry" && customer.sector === key) ||
        (dim === "currency" && (unhedgedByCurrency[key] ?? 0) > 0);
      if (!applies) continue;
      components.push({
        dimension: dim, key, event_id: evt.id, event_type: evt.event_type, severity: evt.severity,
        text: evt.title ?? evt.summary ?? evt.event_type,
      });
    }
  }
  const dimensions = [...new Set(components.map((c) => c.dimension))];
  if (dimensions.length < 2) return null;

  let severity: Sev = dimensions.length >= 3 ? "high" : "medium";
  if (components.some((c) => c.severity === "critical")) severity = bump(severity, 1, "critical");

  const top = Math.max(...components.map((c) => SCORE[c.severity]));
  const risk_score = Math.min(100, top + 10 * (dimensions.length - 1));
  return {
    customer_id: customer.id,
    company_name: customer.company_name,
    dimensions,
    components,
    severity,
    risk_score,
    exposure_usd: customer.current_exposure,
  };
}

export interface MacroCluster {
  country_code: string;
  customers: CustomerMacroResult[];
  dimensions: Dimension[];
  sectors: string[];
  exposure_usd: number;
  severity: Sev;
  confidence: "low" | "medium" | "high";
}

/** Group converging customers by country into portfolio-level clusters. */
export function buildClusters(results: CustomerMacroResult[], customers: MacroCustomer[]): MacroCluster[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const groups = new Map<string, CustomerMacroResult[]>();
  for (const r of results) {
    const cc = byId.get(r.customer_id)?.country_code?.toUpperCase();
    if (!cc) continue;
    groups.set(cc, [...(groups.get(cc) ?? []), r]);
  }
  const clusters: MacroCluster[] = [];
  for (const [country_code, rs] of groups) {
    const dimensions = [...new Set(rs.flatMap((r) => r.dimensions))];
    const sectors = [...new Set(rs.map((r) => byId.get(r.customer_id)?.sector).filter((s): s is string => !!s))];
    const exposure_usd = rs.reduce((s, r) => s + r.exposure_usd, 0);
    const worst = rs.reduce((w, r) => (RANK[r.severity] > RANK[w] ? r.severity : w), "medium" as Sev);
    clusters.push({
      country_code, customers: rs.sort((a, b) => b.exposure_usd - a.exposure_usd), dimensions, sectors, exposure_usd,
      severity: worst,
      confidence: dimensions.length >= 3 ? "high" : "medium",
    });
  }
  return clusters.sort((a, b) => b.exposure_usd - a.exposure_usd);
}
