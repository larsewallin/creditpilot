/**
 * Private companies' statements for Keen (keen_statements.ts): the caps statement taken
 * from the same figures, the age of the accounts against the limit for the score, and the
 * pipeline using both.
 */
import { describe, it, expect } from "vitest";
import { statementFromKeen, financialsAge, maxAgeMonths, type KeenStatements } from "../../../onboarding/keen_statements.ts";
import { runOnboarding } from "../../../onboarding/pipeline.ts";
import { ONBOARDING_DEFAULTS } from "../../../onboarding/settings.ts";
import type { CreditApplication, OnboardingProviders } from "../../../onboarding/types.ts";

const F = ONBOARDING_DEFAULTS.financials;
const cell = (value: number) => ({ value, status: "value" as const });
const statements = (fye = "2025-12-31"): KeenStatements => ({
  version: "KEEN-UPLOAD-2",
  answers: { units: "thousands", basis: "reviewed", currency: "USD", framework: "US GAAP", fiscalYearStart: "2025-01-01", fiscalYearEnd: fye },
  current: {
    "income.revenue": cell(48000), "income.netIncome": cell(2050), "income.operatingIncome": cell(3100),
    "cashFlow.depreciationAndAmortization": cell(610), "balance.totalAssets": cell(24500), "balance.totalLiabilities": cell(13900),
    "balance.totalCurrentAssets": cell(16300), "balance.totalCurrentLiabilities": cell(8200), "balance.totalStockholdersEquity": cell(10600),
    "balance.cashAndCashEquivalents": cell(2200),
  },
  prior: {}, earlierYears: [],
});

describe("statementFromKeen", () => {
  it("takes the caps figures from the Keen statements, in whole dollars", () => {
    expect(statementFromKeen(statements())).toEqual({
      period_end: "2025-12-31", statement_quality: "reviewed", currency: "USD",
      revenue: 48_000_000, net_income: 2_050_000, ebitda: 3_710_000, total_assets: 24_500_000, total_liabilities: 13_900_000,
      current_assets: 16_300_000, current_liabilities: 8_200_000, equity: 10_600_000, cash: 2_200_000,
    });
  });
  it("needs a year end", () => {
    const s = statements(); delete s.answers.fiscalYearEnd;
    expect(statementFromKeen(s)).toBeUndefined();
  });
});

describe("financials age", () => {
  it("is stricter for lower scores", () => {
    expect([maxAgeMonths(85, F), maxAgeMonths(60, F), maxAgeMonths(45, F), maxAgeMonths(20, F), maxAgeMonths(undefined, F)]).toEqual([15, 12, 9, 6, 12]);
  });
  it("counts whole months and marks due soon and stale", () => {
    expect(financialsAge("2025-12-31", "2026-11-13", 80, F)).toEqual({ fye: "2025-12-31", months: 10, max_months: 15, status: "current" });
    expect(financialsAge("2025-12-31", "2026-11-13", 60, F)?.status).toBe("due_soon");   // 10 of 12
    expect(financialsAge("2025-12-31", "2026-11-13", 45, F)?.status).toBe("stale");      // 10 of 9
    expect(financialsAge(undefined, "2026-11-13", 80, F)).toBeUndefined();
  });
});

describe("pipeline with Keen statements", () => {
  const app: CreditApplication = {
    application_id: "A1", submitted_by: "credit_team", legal_name: "Example Supply Co.", country_code: "US", date_established: "2005-01-01",
    people: [], credit_request: { amount_usd: 300_000, terms_days: 30, monthly_purchases_usd: 100_000 },
    trade_references: [{ company_name: "R1" }, { company_name: "R2" }, { company_name: "R3" }],
    financial_statements: [], keen_statements: statements(), signatures: { terms: true, credit_check_consent: true },
  };
  let sent: CreditApplication | undefined;
  const providers = (score: number): OnboardingProviders => ({
    async findExistingCustomer() { return null; },
    async lookupRegistry() { return { source: "state_registry", found: true, status: "active" }; },
    async checkTaxId() { return null; },
    async domainAgeMonths() { return null; },
    async sanctionsList() { return []; },
    async publicFinancials() { return { error: "not_found" }; },
    async keenScore(a) { sent = a; return { provider: "keen", score, keen: { label: "x", as_of: "2025-12-31", reasons: [], warnings: [] } }; },
    async macroContext() { return []; },
  });

  it("is complete above the statements threshold, sends the statements to Keen and caps from them", async () => {
    const o = await runOnboarding(app, providers(82), { asOf: "2026-11-13" });
    expect(o.completeness?.status).toBe("complete");
    expect(sent?.keen_statements?.answers.fiscalYearEnd).toBe("2025-12-31");
    expect(o.analysis?.financials_source).toBe("uploaded_statements");
    expect(o.analysis?.financials_age).toMatchObject({ months: 10, max_months: 15, status: "current" });
    expect(o.proposal?.reason_codes).not.toContain("FINANCIALS_STALE");
  });
  it("flags stale accounts for a low score", async () => {
    const o = await runOnboarding(app, providers(45), { asOf: "2026-11-13" });
    expect(o.analysis?.financials_age?.status).toBe("stale");
    expect(o.proposal?.reason_codes).toContain("FINANCIALS_STALE");
  });
});
