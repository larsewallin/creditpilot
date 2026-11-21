import { describe, it, expect } from "vitest";
import { calculateOnboardingLimit, scoreToBand } from "../calculate-onboarding-limit.ts";
import { ONBOARDING_DEFAULTS } from "../../../onboarding/settings.ts";

const L = ONBOARDING_DEFAULTS.limits;
const stmt = (o: Record<string, unknown> = {}) => ({
  period_end: "2025-12-31", statement_quality: "audited" as const, currency: "USD",
  current_assets: 760_000, current_liabilities: 380_000, equity: 600_000, ...o,
});
const base = { requested_usd: 35_000, monthly_purchases_usd: 32_000, terms_days: 30, statement: stmt(), band: "very_strong" as const, macro: { country: false, fx: false }, limits: L };

describe("scoreToBand", () => {
  it("maps score to CreditPilot's labels at the boundaries", () => {
    expect([85, 84, 70, 69, 55, 54, 40, 39, 25, 24].map(scoreToBand)).toEqual(
      ["very_strong", "strong", "strong", "adequate", "adequate", "watch", "watch", "elevated", "elevated", "high_risk"]);
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

  it("counteroffers when working capital binds; Strong takes the full cap (G03)", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 500_000, monthly_purchases_usd: 150_000, terms_days: 60,
      statement: stmt({ current_assets: 3_000_000, current_liabilities: 1_500_000, equity: 2_500_000 }), band: "strong" });
    expect(r.decision).toBe("counteroffer");
    expect(r.proposed_usd).toBe(150_000);
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

  it("applies the policy's haircut for compiled statements, 30% (G14)", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 75_000, monthly_purchases_usd: 50_000, terms_days: 45,
      statement: stmt({ statement_quality: "compiled", current_assets: 2_000_000, current_liabilities: 1_000_000, equity: 1_600_000 }) });
    expect(r.caps.working_capital).toBe(70_000);
    expect(r.proposed_usd).toBe(70_000);
    expect(r.reason_codes).toContain("STATEMENT_QUALITY_COMPILED");
  });

  it("uses the bureau recommendation when there are no financials (G08)", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 45_000, monthly_purchases_usd: 40_000, statement: undefined,
      max_credit_recommendations_usd: [120_000], band: "strong" });
    expect(r.supportable_usd).toBe(120_000);
    expect(r.proposed_usd).toBe(45_000);
    expect(r.higher_limit_note).toBe(true);
  });

  it("never proposes more than requested", () => {
    const r = calculateOnboardingLimit({ ...base, requested_usd: 10_000 });
    expect(r.proposed_usd).toBe(10_000);
    expect(r.higher_limit_note).toBe(true);
  });

  it("sends to a person when there is no score, no cap basis, or a High risk score", () => {
    expect(calculateOnboardingLimit({ ...base, band: null }).reason_codes).toContain("NO_SCORE_AVAILABLE");
    expect(calculateOnboardingLimit({ ...base, statement: undefined }).reason_codes).toContain("NO_CAP_BASIS");
    const e = calculateOnboardingLimit({ ...base, band: "high_risk" });
    expect(e.decision).toBe("decline_review");
    expect(e.reason_codes).toContain("SCORE_HIGH_RISK");
  });

  // Founder, 2026-11-20: Adequate and better are good credits (100%); Watch 80%; Elevated 50%,
  // High risk 0%.
  it("gives Adequate the full cap, Watch 80% and Elevated 50%", () => {
    const big = { ...base, requested_usd: 500_000, monthly_purchases_usd: 300_000 };
    expect(calculateOnboardingLimit({ ...big, band: "adequate" }).risk_adjusted_cap_usd).toBe(38_000);
    expect(calculateOnboardingLimit({ ...big, band: "watch" }).risk_adjusted_cap_usd).toBeCloseTo(30_400);
    expect(calculateOnboardingLimit({ ...big, band: "elevated" }).risk_adjusted_cap_usd).toBe(19_000);
  });

  it("gives Elevated 50% whatever the company's size (no size exception)", () => {
    const r = calculateOnboardingLimit({ ...base, band: "elevated", statement: stmt({ revenue: 100_000_000 }) });
    expect(r.risk_adjusted_cap_usd).toBe(19_000);
  });

  it("haircuts each statement quality by the policy", () => {
    const cap = (q: "audited" | "reviewed" | "compiled" | "management") =>
      calculateOnboardingLimit({ ...base, requested_usd: 500_000, statement: stmt({ statement_quality: q }) }).caps.working_capital;
    expect([cap("audited"), cap("reviewed"), cap("compiled"), cap("management")]).toEqual([38_000, 32_300, 26_600, 19_000]);
  });
});
