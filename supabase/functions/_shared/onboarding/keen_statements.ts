/**
 * A private company's statements for Keen, and how old they are.
 *
 * The form sends the statements in Keen's upload-template shape (GET {KEEN_API_URL}/v1/template
 * lists the lines and answers), so Keen scores them exactly as an upload in Keen. The same figures
 * give the onboarding pipeline its balance-sheet statement for the limit caps: one entry, two uses.
 *
 * Age: months from the financial year end to today. The lower the score, the sooner newer accounts
 * are needed (settings onboarding.financials; defaults in settings.ts).
 */
import type { FinancialStatement, OnboardingSettings } from "./types.ts";

export type LineStatus = "value" | "derived" | "approximate" | "none" | "notProvided";
export interface Cell { value: number | null; status: LineStatus }
export interface KeenStatements {
  version: string;
  answers: {
    companyName?: string;
    industry?: { choice?: string; naics?: string; sic?: string };
    framework?: string;
    currency?: string;
    units?: "dollars" | "thousands" | "millions";
    basis?: "audited" | "reviewed" | "compiled" | "management";
    fiscalYearStart?: string;
    fiscalYearEnd?: string;
    priorYearEnd?: string;
    hasCashFlowStatement?: boolean;
    yearsOfAccounts?: number;
    takesDeposits?: boolean;
    bankruptcy?: { filed: boolean; date?: string };
    goingConcern?: { stated: boolean };
    [k: string]: unknown;
  };
  current: Record<string, Cell>;
  prior: Record<string, Cell>;
  earlierYears: unknown[];
}

const UNIT: Record<string, number> = { dollars: 1, thousands: 1e3, millions: 1e6 };
const num = (c?: Cell) => (c && typeof c.value === "number" && Number.isFinite(c.value) ? c.value : undefined);

/** The balance-sheet and income figures the limit caps use, in whole currency units. */
export function statementFromKeen(t: KeenStatements): FinancialStatement | undefined {
  const a = t?.answers ?? {};
  if (!a.fiscalYearEnd) return undefined;
  const f = UNIT[a.units ?? "dollars"] ?? 1;
  const v = (k: string) => { const x = num(t.current?.[k]); return x === undefined ? undefined : x * f; };
  const op = v("income.operatingIncome"), da = v("cashFlow.depreciationAndAmortization");
  const cash = v("balance.cashAndCashEquivalents");
  return {
    period_end: a.fiscalYearEnd.slice(0, 10),
    statement_quality: a.basis ?? "management",
    currency: (a.currency ?? "USD").toUpperCase(),
    revenue: v("income.revenue"),
    net_income: v("income.netIncome"),
    ebitda: op !== undefined && da !== undefined ? op + da : undefined,
    total_assets: v("balance.totalAssets"),
    total_liabilities: v("balance.totalLiabilities"),
    current_assets: v("balance.totalCurrentAssets"),
    current_liabilities: v("balance.totalCurrentLiabilities"),
    equity: v("balance.totalStockholdersEquity") ?? v("balance.totalEquity"),
    cash,
  };
}

export interface FinancialsAge {
  fye: string;
  months: number;
  max_months: number;
  status: "current" | "due_soon" | "stale";
}

/** The most months a year end may be old, for this score (no score: the strictest-but-one row). */
export function maxAgeMonths(score: number | undefined, s: OnboardingSettings["financials"]): number {
  if (score === undefined || !Number.isFinite(score)) return s.max_age_months_no_score;
  if (score >= 70) return s.max_age_months_70_plus;
  if (score >= 55) return s.max_age_months_55_to_69;
  if (score >= 40) return s.max_age_months_40_to_54;
  return s.max_age_months_below_40;
}

/** Whole months from the year end to asOf; due soon within `due_soon_months` of the limit. */
export function financialsAge(fye: string | undefined, asOf: string, score: number | undefined, s: OnboardingSettings["financials"]): FinancialsAge | undefined {
  if (!fye || !/^\d{4}-\d{2}-\d{2}/.test(fye)) return undefined;
  const [y1, m1, d1] = fye.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = asOf.slice(0, 10).split("-").map(Number);
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  const max = maxAgeMonths(score, s);
  const status = months >= max ? "stale" : months >= max - s.due_soon_months ? "due_soon" : "current";
  return { fye: fye.slice(0, 10), months, max_months: max, status };
}
