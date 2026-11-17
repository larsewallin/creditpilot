/**
 * Plain-language names for credit event types, used on cards and in the
 * multi-agent summaries ("4 warning signs for X: overdue invoices, slower payments…").
 */

/** Short card label (title case). */
export const EVENT_LABEL: Record<string, string> = {
  NEWS_EVENT: "Negative news",
  NEGATIVE_NEWS: "Negative news",
  COVENANT_WAIVER: "Covenant waiver",
  CEO_DEPARTURE: "CEO departure",
  REVENUE_MISS: "Revenue miss",
  GOING_CONCERN: "Going-concern doubt",
  SEC_OTHER: "SEC filing warning",
  OVERDUE_AR: "Overdue invoices",
  UTILIZATION_THRESHOLD_BREACH: "Near or over credit limit",
  PAYMENT_DETERIORATION: "Slower payments",
  PAYMENT_IMPROVEMENT: "Faster payments",
  PAYMENT_VOLATILITY: "Erratic payments",
  COUNTRY_RATING_CHANGE: "Country rating change",
  COUNTRY_POLITICAL_RISK: "Political risk",
  COUNTRY_ECONOMIC_SHOCK: "Economic shock",
  INTEREST_RATE_CHANGE: "Interest rate change",
  INDUSTRY_DOWNTURN: "Industry downturn",
  INDUSTRY_DISRUPTION: "Industry disruption",
  REGULATORY_CHANGE: "Regulatory change",
  TARIFF_CHANGE: "Tariff change",
  RISK_CHANGE: "Country, industry or currency exposure",
  CONCENTRATION_THRESHOLD_BREACH: "Concentration limit",
  CONCENTRATION_WARNING: "Concentration warning",
  PORTFOLIO_INSIGHT: "Portfolio insight",
  EXPANSION_OPPORTUNITY: "Growth opportunity",
  EMERGING_RISK_SIGNAL: "Emerging risk",
  MACRO_TREND_WARNING: "Macro trend warning",
  FX_EXPOSURE_FLAG: "Currency exposure",
  FX_HEDGING_NEEDED: "Hedging needed",
  CURRENCY_VOLATILITY: "Currency volatility",
  CREDIT_RATING_DOWNGRADE: "Lower credit score",
  CREDIT_RATING_UPGRADE: "Higher credit score",
  FINANCIALS_STALE: "Accounts out of date",
  COMPOSITE_RISK_CRITICAL: "Several warning signs",
  COMPOSITE_RISK_ELEVATED: "Several warning signs",
  DAILY_BRIEFING: "Daily briefing",
};

/** Lower-case phrase for a summary sentence. */
export const EVENT_PHRASE: Record<string, string> = {
  NEWS_EVENT: "negative news",
  NEGATIVE_NEWS: "negative news",
  COVENANT_WAIVER: "a covenant waiver",
  CEO_DEPARTURE: "a CEO departure",
  REVENUE_MISS: "a revenue miss",
  GOING_CONCERN: "a going-concern doubt in its SEC filing",
  SEC_OTHER: "a warning in its SEC filing",
  OVERDUE_AR: "overdue invoices",
  UTILIZATION_THRESHOLD_BREACH: "a balance near or over its credit limit",
  PAYMENT_DETERIORATION: "slower payments",
  PAYMENT_IMPROVEMENT: "faster payments",
  PAYMENT_VOLATILITY: "erratic payments",
  RISK_CHANGE: "country, industry or currency exposure",
  CREDIT_RATING_DOWNGRADE: "a lower credit score",
  FINANCIALS_STALE: "out-of-date accounts",
  FX_EXPOSURE_FLAG: "currency exposure",
  CONCENTRATION_THRESHOLD_BREACH: "a concentration limit breach",
};

export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const eventPhrase = (t: string) => EVENT_PHRASE[t] ?? eventLabel(t).toLowerCase();

export const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export interface SignalLite { id: string; event_type: string; severity: string; source_agent: string }

/**
 * The sentence and the "why" line for a multi-agent summary, from the signals it was
 * built from (one phrase per kind of signal, most serious first).
 */
export function summarize(company: string, signals: SignalLite[], severity: string) {
  const sorted = [...signals].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  const phrases: string[] = [];
  for (const s of sorted) { const p = eventPhrase(s.event_type); if (!phrases.includes(p)) phrases.push(p); }
  const agents = new Set(signals.map((s) => s.source_agent)).size;
  const n = phrases.length;
  const headline = n
    ? `${n} warning sign${n > 1 ? "s" : ""} for ${company}: ${phrases.join(", ")}.`
    : `Several agents flag ${company}.`;
  const top = sorted[0];
  const why = top
    ? `${severity === "critical" ? "Critical" : severity === "high" ? "High" : "Rated " + severity} because its most serious signal (${eventPhrase(top.event_type)}) is ${top.severity}, and ${agents} different agent${agents > 1 ? "s" : ""} flag it.`
    : "";
  return { headline, why };
}
