/**
 * analyse-fx-exposure — pure FX-risk logic for the FX Risk agent (no I/O).
 *
 * Product stance: CreditPilot is a credit-risk product, not a treasury system.
 * FX is one risk factor on foreign-currency receivables:
 *   - Seller reports in USD with USD costs, so EUR/JPY receivables are exposed.
 *   - Only the ADVERSE direction matters (foreign currency weakening vs USD).
 *   - We flag large UNHEDGED exposure; we never size or recommend hedges.
 *   - Volatility alone never creates an action (the agent only emits events).
 *
 * Rate convention everywhere: `rate` = units of foreign currency per 1 USD
 * (e.g. EUR 0.92, JPY 150). A RISING rate means the foreign currency WEAKENED.
 * USD value of a foreign amount = amount / rate.
 *
 * All thresholds are unvalidated defaults (no published standard exists) and are
 * isolated in FX_POLICY_DEFAULTS so the future Settings page (backlog D5) can
 * override them per company.
 */

export type FxSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface FxPolicy {
  /** Unhedged foreign-currency exposure at or above this (USD) is "large". */
  UNHEDGED_FLOOR_USD: number;
  /** Unhedged exposure at or above this % of total portfolio exposure is "large". */
  UNHEDGED_SHARE_PCT: number;
  /** USD-value move (30d, or since booking) at or beyond this % counts as adverse/notable. */
  ADVERSE_MOVE_PCT: number;
  /** Annualised realised volatility (%) at or above this bumps volatility severity. */
  HIGH_VOL_PCT: number;
  /** Average invoice-to-payment window (days) at or above this escalates an adverse exposure flag. */
  LONG_WINDOW_DAYS: number;
  /** Trading-day window for realised volatility. */
  VOL_WINDOW_DAYS: number;
  /** Live-mode cooldown between CURRENCY_VOLATILITY events for one currency. */
  COOLDOWN_DAYS: number;
}

export const FX_POLICY_DEFAULTS: FxPolicy = {
  UNHEDGED_FLOOR_USD: 1_000_000,
  UNHEDGED_SHARE_PCT: 10,
  ADVERSE_MOVE_PCT: 3,
  HIGH_VOL_PCT: 12,
  LONG_WINDOW_DAYS: 60,
  VOL_WINDOW_DAYS: 30,
  COOLDOWN_DAYS: 7,
};

export interface RatePoint {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** units of foreign currency per 1 USD */
  rate: number;
}

const LEVELS: FxSeverity[] = ["info", "low", "medium", "high", "critical"];

function bump(sev: FxSeverity, steps: number, cap: FxSeverity): FxSeverity {
  const i = Math.min(LEVELS.indexOf(sev) + steps, LEVELS.indexOf(cap));
  return LEVELS[Math.max(i, 0)];
}

/** % change in the USD value of a foreign amount when the rate moves ref -> now. Negative = adverse. */
export function usdValueChangePct(refRate: number, nowRate: number): number {
  if (!(refRate > 0) || !(nowRate > 0)) return 0;
  return (refRate / nowRate - 1) * 100;
}

/** Sort ascending by date (does not mutate). */
function sorted(series: RatePoint[]): RatePoint[] {
  return [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/**
 * USD-value change (%) of a foreign amount over the last `days` calendar days of the series
 * (reference = latest point dated on/before latest - days; falls back to the earliest point).
 * Returns null if the series has fewer than 2 points.
 */
export function changeOverDaysPct(series: RatePoint[], days: number): number | null {
  const s = sorted(series);
  if (s.length < 2) return null;
  const latest = s[s.length - 1];
  let ref = s[0];
  for (const p of s) {
    if (daysBetween(p.date, latest.date) >= days) ref = p;
    else break;
  }
  if (ref === latest) return null;
  return usdValueChangePct(ref.rate, latest.rate);
}

/**
 * Annualised realised volatility (%) = sample stdev of daily log returns over the last
 * `windowReturns` returns x sqrt(252). Null if fewer than 5 returns are available.
 */
export function realisedVolPct(series: RatePoint[], windowReturns: number): number | null {
  const s = sorted(series);
  if (s.length < 6) return null;
  const tail = s.slice(-(windowReturns + 1));
  const rets: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    if (tail[i - 1].rate > 0 && tail[i].rate > 0) rets.push(Math.log(tail[i].rate / tail[i - 1].rate));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export interface CurrencyExposure {
  currency: string;
  /** Outstanding USD (at booking) on unhedged foreign-currency invoices. */
  unhedged_usd: number;
  /** Outstanding USD (at booking) on hedged invoices. */
  hedged_usd: number;
  /** Total portfolio exposure in USD (all customers, all currencies) for the share test. */
  total_portfolio_exposure_usd: number;
  /** Weighted USD-value change (%) of the unhedged book since booking. Negative = loss. */
  unhedged_value_change_pct: number;
  /** Exposure-weighted average invoice-to-expected-payment window in days (unhedged book). */
  avg_window_days: number;
}

export interface FxExposureFlag {
  severity: FxSeverity;
  share_of_portfolio_pct: number;
  adverse: boolean;
  reason: string;
}

/**
 * FX_EXPOSURE_FLAG: large UNHEDGED foreign-currency exposure.
 * Fires on size alone (the user's rule: unhedged and large => flag); an adverse move
 * (30d, or since booking) and a long exposure window escalate the severity. Capped at "high".
 * Returns null when nothing is unhedged or exposure is not large.
 */
export function evaluateFxExposureFlag(
  exp: CurrencyExposure,
  change30dPct: number | null,
  policy: FxPolicy = FX_POLICY_DEFAULTS,
): FxExposureFlag | null {
  if (!(exp.unhedged_usd > 0)) return null;
  const share =
    exp.total_portfolio_exposure_usd > 0 ? (exp.unhedged_usd / exp.total_portfolio_exposure_usd) * 100 : 0;
  const large = exp.unhedged_usd >= policy.UNHEDGED_FLOOR_USD || share >= policy.UNHEDGED_SHARE_PCT;
  if (!large) return null;

  let severity: FxSeverity = exp.unhedged_usd >= policy.UNHEDGED_FLOOR_USD * 5 ? "medium" : "low";
  const adverse =
    (change30dPct !== null && change30dPct <= -policy.ADVERSE_MOVE_PCT) ||
    exp.unhedged_value_change_pct <= -policy.ADVERSE_MOVE_PCT;
  if (adverse) {
    severity = bump(severity, 1, "high");
    if (exp.avg_window_days >= policy.LONG_WINDOW_DAYS) severity = bump(severity, 1, "high");
  }

  const parts = [
    `${exp.currency} receivables: $${Math.round(exp.unhedged_usd).toLocaleString("en-US")} unhedged` +
      ` (${share.toFixed(1)}% of portfolio exposure)`,
  ];
  if (adverse) {
    parts.push(
      `${exp.currency} has weakened against USD` +
        (change30dPct !== null ? ` (${change30dPct.toFixed(1)}% USD value over 30 days)` : "") +
        `; unhedged book is ${exp.unhedged_value_change_pct.toFixed(1)}% vs booking`,
    );
  }
  parts.push(`average exposure window ${Math.round(exp.avg_window_days)} days`);
  return { severity, share_of_portfolio_pct: share, adverse, reason: parts.join("; ") + "." };
}

export interface CurrencyVolatility {
  severity: FxSeverity;
  direction: "adverse" | "favourable";
  change_30d_pct: number;
  volatility_pct: number | null;
}

/**
 * CURRENCY_VOLATILITY: a material 30-day USD-value move in a currency the portfolio is exposed to.
 * Favourable moves are "info" (a gain; never an alert). Adverse: medium (>= threshold),
 * high (>= 6%), critical (>= 10%); high realised volatility bumps one level. Capped at "low"
 * when total exposure in the currency is below the materiality floor.
 */
export function evaluateCurrencyVolatility(
  change30dPct: number | null,
  volPct: number | null,
  currencyExposureUsd: number,
  policy: FxPolicy = FX_POLICY_DEFAULTS,
): CurrencyVolatility | null {
  if (change30dPct === null || Math.abs(change30dPct) < policy.ADVERSE_MOVE_PCT) return null;
  if (change30dPct > 0) {
    return { severity: "info", direction: "favourable", change_30d_pct: change30dPct, volatility_pct: volPct };
  }
  const m = Math.abs(change30dPct);
  let severity: FxSeverity = m >= 10 ? "critical" : m >= 6 ? "high" : "medium";
  if (volPct !== null && volPct >= policy.HIGH_VOL_PCT) severity = bump(severity, 1, "critical");
  if (currencyExposureUsd < policy.UNHEDGED_FLOOR_USD) severity = "low";
  return { severity, direction: "adverse", change_30d_pct: change30dPct, volatility_pct: volPct };
}
