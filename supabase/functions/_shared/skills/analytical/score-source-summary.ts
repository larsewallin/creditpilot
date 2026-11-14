/**
 * @skill score-source-summary
 * @type analytical
 * @description Deterministic counts CIA hands the model as facts: how many active customers
 *   have a score from each source, and which customers' accounts are out of date or due soon
 *   (financial year end against the limit for their score, Settings › How old accounts may be).
 *   The model explains these numbers; it never counts customers itself (CLAUDE.md arithmetic rule).
 * @usedBy cia-agent (question mode)
 */
import { financialsAge } from "../../onboarding/keen_statements.ts";
import type { OnboardingSettings } from "../../onboarding/types.ts";

export const SOURCE_LABEL: Record<string, string> = {
  keen: "Keen", sp: "S&P", sp_fitch: "S&P / Fitch", moodys: "Moody's", fitch: "Fitch", dnb: "Dun & Bradstreet",
  dnb_paydex: "D&B Paydex", creditsafe: "Creditsafe", coface: "Coface", allianz_trade: "Allianz Trade", experian: "Experian",
  other: "Other provider", bureau_report: "Bureau report",
};

export interface SummaryCustomer {
  company_name: string;
  credit_rating_score: number | null;
  credit_rating_source: string | null;
  financials_fye?: string | null;
}

export interface ScoreSourceSummary {
  customers: number;
  by_source: { source: string; label: string; count: number }[];
  no_score: number;
  with_year_end: number;
  accounts: { company_name: string; fye: string; months: number; max_months: number; status: "stale" | "due_soon" }[];
}

export function summarizeScoreSources(rows: SummaryCustomer[], financials: OnboardingSettings["financials"], asOf: string): ScoreSourceSummary {
  const counts = new Map<string, number>();
  let noScore = 0, withFye = 0;
  const accounts: ScoreSourceSummary["accounts"] = [];
  for (const c of rows) {
    if (c.credit_rating_score === null || c.credit_rating_score === undefined) noScore++;
    else { const s = c.credit_rating_source ?? "unknown"; counts.set(s, (counts.get(s) ?? 0) + 1); }
    if (c.financials_fye) {
      withFye++;
      const age = financialsAge(String(c.financials_fye), asOf, c.credit_rating_score ?? undefined, financials);
      if (age && age.status !== "current") accounts.push({ company_name: c.company_name, fye: age.fye, months: age.months, max_months: age.max_months, status: age.status });
    }
  }
  accounts.sort((a, b) => (a.status === b.status ? b.months - a.months : a.status === "stale" ? -1 : 1));
  return {
    customers: rows.length,
    by_source: [...counts.entries()].map(([source, count]) => ({ source, label: SOURCE_LABEL[source] ?? source, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    no_score: noScore,
    with_year_end: withFye,
    accounts,
  };
}

/** The two context sections CIA adds for score-source and accounts-age questions. */
export function scoreSourceBlocks(s: ScoreSourceSummary): string[] {
  const src = `## OFFICIAL SCORE SOURCE SUMMARY (pre-computed, deterministic — the authoritative answer to "where do our credit scores come from" / "which provider scores our customers" questions; do not count customers yourself)\n` +
    `- Active customers: ${s.customers}\n` +
    s.by_source.map((b) => `- Scored by ${b.label}: ${b.count}`).join("\n") + (s.by_source.length ? "\n" : "") +
    `- No credit score: ${s.no_score}`;
  const acc = `## OFFICIAL ACCOUNTS AGE LIST (pre-computed, deterministic — the authoritative answer to "whose financial statements are out of date / how old are the accounts" questions; a lower score allows older accounts for less time; do not compute ages yourself)\n` +
    (s.with_year_end === 0
      ? `- No financial year end is recorded for any customer yet (it is recorded when a customer is approved through onboarding or re-scored from its accounts).`
      : `- Customers with a recorded financial year end: ${s.with_year_end}\n` +
        (s.accounts.length
          ? s.accounts.map((a) => `- ${a.company_name}: year ended ${a.fye}, ${a.months} months old, limit ${a.max_months} months — ${a.status === "stale" ? "OUT OF DATE" : "due soon"}`).join("\n")
          : `- None are out of date or due soon.`));
  return [src, acc];
}
