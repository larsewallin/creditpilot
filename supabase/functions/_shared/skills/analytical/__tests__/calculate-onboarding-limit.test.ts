import { describe, it, expect } from "vitest";
import { calculateOnboardingLimit, scoreToBand } from "../calculate-onboarding-limit.ts";
import { ONBOARDING_DEFAULTS } from "../../../onboarding/settings.ts";

const L = ONBOARDING_DEFAULTS.limits;
const stmt = (o: Record<string, unknown> = {}) => ({
  period_end: "2025-12-31", statement_quality: "reviewed" as const, currency: "USD",
  current_assets: 760_000, current_liabilities: 380_000, equity: 600_000, ...o,
});
const base = { requested_usd: 35_000, monthly_purchases_usd: 32_000, terms_days: 30, statement: stmt(), band: "A" as const, macro: { country: false, fx: false }, limits: L };

describe("scoreToBand", () => {
  it("maps score to bands at the boundaries", () => {
    expect([90, 89, 80, 79, 70, 69, 60, 59].map(scoreToBand)).toEqual(["A", "B", "B", "C", "C", "D", "D", "E"]);
    expect(scoreToBand(null)).toBe(null);
  });
});

describe("calculateOnboardingLimit", () => {
  it("approves as requested when needs bind (G01)", () => {
    const r = calculateOnboardingLimit(base);
    expect(r.decision).toBe("approve_as_requested");
    expect(r.recommended_usd).toBe(35_000);
    expect(r.supportable_usd).toBe(35_000);
    expect(r.binding_method).toBe("needs_based");
    expect(r.higher_limit_note).toBe(false);
    expect(r.human_required).toBe(true);
  });

  it("counteroffers when working capital binds, with band B (G03)", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 500_000, monthly_purchases_usd: 150_000, terms_days: 60,
      statement: stmt({ current_assets: 3_000_000, current_liabilities: 1_500_000, equity: 2_500_000 }), band: "B" });
    expect(r.decision).toBe("counteroffer");
    expect(r.proposed_usd).toBe(110_000);
    expect(r.binding_method).toBe("working_capital");
    expect(r.reason_codes).toContain("LIMIT_CAPPED_WORKING_CAPITAL");
  });

  it("applies the macro haircut once for country and FX together (G10)", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 220_000, monthly_purchases_usd: 100_000, terms_days: 60,
      statement: stmt({ statement_quality: "audited", current_assets: 5_000_000, current_liabilities: 2_500_000, equity: 4_000_000 }),
      macro: { country: true, fx: true } });
    expect(r.risk_adjusted_cap_usd).toBe(200_000);
    expect(r.proposed_usd).toBe(200_000);
    expect(r.reason_codes).toEqual(expect.arrayContaining(["MACRO_COUNTRY_RISK", "MACRO_FX_RISK"]));
  });

  it("halves balance-sheet caps for compiled statements (G14)", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 75_000, monthly_purchases_usd: 50_000, terms_days: 45,
      statement: stmt({ statement_quality: "compiled", current_assets: 2_000_000, current_liabilities: 1_000_000, equity: 1_600_000 }) });
    expect(r.caps.working_capital).toBe(50_000);
    expect(r.proposed_usd).toBe(50_000);
    expect(r.reason_codes).toContain("STATEMENT_QUALITY_COMPILED");
  });

  it("uses the bureau recommendation when there are no financials (G08)", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 45_000, monthly_purchases_usd: 40_000, statement: undefined,
      max_credit_recommendations_usd: [120_000], band: "B" });
    expect(r.supportable_usd).toBe(90_000);
    expect(r.proposed_usd).toBe(45_000);
    expect(r.higher_limit_note).toBe(true);
  });

  it("never proposes more than requested", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 10_000 });
    expect(r.proposed_usd).toBe(10_000);
    expect(r.higher_limit_note).toBe(true);
  });

  it("sends to a person when there is no score, no cap basis, or band E", () => {
    expect(calculateOnboardingLimit({ ...base, band: null }).reason_codes).toContain("NO_SCORE_AVAILABLE");
    expect(calculateOnboardingLimit({ ...base, statement: undefined }).reason_codes).toContain("NO_CAP_BASIS");
    const e = calculateOnboardingLimit({ ...base, band: "E" });
    expect(e.decision).toBe("decline_review");
    expect(e.reason_codes).toContain("SCORE_BAND_E");
  });
});
