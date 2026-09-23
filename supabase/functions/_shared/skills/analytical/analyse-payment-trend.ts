/**
 * @skill analyse-payment-trend
 * @type analytical
 * @description Compares a customer's payment timing over two adjacent 30-day windows
 *   (current: last 30 days from the reference date; prior: the 30 days before that) and
 *   detects three independent conditions from `days_early_late` (negative = paid early,
 *   positive = paid late):
 *
 *     DETERIORATION — current_avg − prior_avg >= 5 AND current_avg > 0
 *     IMPROVEMENT   — prior_avg − current_avg >= 5 AND prior_avg > 0
 *     VOLATILITY    — population stddev of days_early_late within the current window >= 10
 *
 *   Volatility is checked independently of deterioration/improvement — a customer can
 *   trigger both a trend condition and volatility in the same evaluation.
 *
 *   Severity scales with the magnitude of the swing (deterioration/prior−current for
 *   improvement) or of the stddev (volatility), all measured in days:
 *     5–10   → deterioration: medium   | improvement: info
 *     10–20  → deterioration: high     | improvement: low
 *     20+    → deterioration: critical | improvement: low (capped — see below)
 *   Volatility only ever fires at stddev >= 10, so its band starts at "high":
 *     10–20  → high
 *     20+    → critical
 *
 *   Improvement severity is capped at "low" by convention — severity denotes urgency,
 *   and a positive trend never needs escalation regardless of how large the swing is
 *   (see docs/EVENT_TAXONOMY.md, PAYMENT_IMPROVEMENT: "Severity: info to low").
 *
 *   Either window having zero qualifying transactions is treated as insufficient data
 *   for deterioration/improvement (nothing to compare); volatility only requires the
 *   current window.
 *
 * @input PaymentTrendTransaction[] — a customer's payment_transactions rows
 * @output PaymentTrendResult
 * @usedBy payment-behaviour-agent
 */

export interface PaymentTrendTransaction {
  payment_date: string;
  days_early_late: number | null;
}

export interface DeteriorationSignal {
  trend_direction: "worsening" | "sharply_worsening";
  severity: "medium" | "high" | "critical";
}

export interface ImprovementSignal {
  trend_direction: "improving" | "sharply_improving";
  severity: "info" | "low";
}

export interface VolatilitySignal {
  severity: "high" | "critical";
  standard_deviation_days: number;
}

export interface InsufficientDataResult {
  has_sufficient_data: false;
  current_window_count: number;
  prior_window_count: number;
}

export interface EvaluatedResult {
  has_sufficient_data: true;
  current_avg_days_late: number;
  prior_avg_days_late: number;
  current_window_count: number;
  prior_window_count: number;
  deterioration: DeteriorationSignal | null;
  improvement: ImprovementSignal | null;
  volatility: VolatilitySignal | null;
}

/** Discriminated on has_sufficient_data — narrow before reading the averages/signals. */
export type PaymentTrendResult = InsufficientDataResult | EvaluatedResult;

export const OBSERVATION_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function populationStdDev(values: number[]): number {
  const avg = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function deteriorationSeverity(swing: number): DeteriorationSignal {
  if (swing >= 20) return { trend_direction: "sharply_worsening", severity: "critical" };
  if (swing >= 10) return { trend_direction: "sharply_worsening", severity: "high" };
  return { trend_direction: "worsening", severity: "medium" };
}

function improvementSeverity(swing: number): ImprovementSignal {
  if (swing >= 10) return { trend_direction: "sharply_improving", severity: "low" };
  return { trend_direction: "improving", severity: "info" };
}

function volatilitySeverity(stddev: number): VolatilitySignal["severity"] {
  return stddev >= 20 ? "critical" : "high";
}

export function analysePaymentTrend(
  transactions: PaymentTrendTransaction[],
  referenceDate: Date = new Date()
): PaymentTrendResult {
  const valid = (transactions ?? []).filter(
    (t): t is PaymentTrendTransaction & { days_early_late: number } => t.days_early_late !== null
  );

  const now = referenceDate.getTime();
  const currentStart = now - OBSERVATION_WINDOW_DAYS * MS_PER_DAY;
  const priorStart = now - 2 * OBSERVATION_WINDOW_DAYS * MS_PER_DAY;

  const currentWindow: number[] = [];
  const priorWindow: number[] = [];
  for (const t of valid) {
    const ts = new Date(t.payment_date).getTime();
    if (ts >= currentStart && ts <= now) {
      currentWindow.push(t.days_early_late);
    } else if (ts >= priorStart && ts < currentStart) {
      priorWindow.push(t.days_early_late);
    }
  }

  if (currentWindow.length === 0 || priorWindow.length === 0) {
    return {
      has_sufficient_data: false,
      current_window_count: currentWindow.length,
      prior_window_count: priorWindow.length,
    };
  }

  const current_avg_days_late = round1(mean(currentWindow));
  const prior_avg_days_late = round1(mean(priorWindow));
  const swing = current_avg_days_late - prior_avg_days_late;

  const deterioration =
    swing >= 5 && current_avg_days_late > 0 ? deteriorationSeverity(swing) : null;

  const improvement =
    -swing >= 5 && prior_avg_days_late > 0 ? improvementSeverity(-swing) : null;

  const stddev = round1(populationStdDev(currentWindow));
  const volatility: VolatilitySignal | null =
    stddev >= 10 ? { severity: volatilitySeverity(stddev), standard_deviation_days: stddev } : null;

  return {
    has_sufficient_data: true,
    current_avg_days_late,
    prior_avg_days_late,
    current_window_count: currentWindow.length,
    prior_window_count: priorWindow.length,
    deterioration,
    improvement,
    volatility,
  };
}
