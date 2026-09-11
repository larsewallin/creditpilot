import { describe, it, expect } from "vitest";
import { calculateCreditLimitProposal } from "../calculate-credit-limit-proposal";

const BASE: Parameters<typeof calculateCreditLimitProposal>[0] = {
  current_limit: 500_000,
  current_exposure: 400_000,
  days_over_90: 0,
  utilization_pct: 80,
  credit_score: null,
  is_strategic_account: false,
  on_time_rate: 1,
};

describe("calculateCreditLimitProposal", () => {
  it("returns no_action when no risk criteria are met", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 50,
      days_over_90: 0,
    });
    expect(result.action).toBe("no_action");
    expect(result.reduction_pct).toBe(0);
    expect(result.proposed_limit).toBe(500_000);
  });

  it("returns no_action for zero current_limit", () => {
    const result = calculateCreditLimitProposal({ ...BASE, current_limit: 0 });
    expect(result.action).toBe("no_action");
  });

  it("applies 50% reduction for distress score + high overdue (non-preferred)", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      days_over_90: 80_000,
      utilization_pct: 80,
      credit_score: 15, // < 20 = distress
    });
    expect(result.action).toBe("reduce");
    expect(result.reduction_pct).toBe(50);
    expect(result.proposed_limit).toBe(250_000);
  });

  it("strategic account in distress + high overdue gets 40% reduction (not 50%)", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      days_over_90: 80_000,
      utilization_pct: 80,
      credit_score: 15, // < 20 = distress
      is_strategic_account: true,
    });
    expect(result.action).toBe("reduce");
    expect(result.reduction_pct).toBe(40);
    expect(result.proposed_limit).toBe(300_000);
  });

  it("strategic account high util threshold is 80pp not 70pp", () => {
    // 75% util: triggers for non-strategic but NOT for strategic account (threshold is 80)
    const nonStrategic = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 75,
      days_over_90: 60_000,
      credit_score: null,
    });
    const strategic = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 75,
      days_over_90: 60_000,
      credit_score: null,
      is_strategic_account: true,
    });
    expect(nonStrategic.action).toBe("reduce");
    expect(strategic.action).toBe("no_action");
  });

  it("enforces minimum 25% reduction for non-preferred customers", () => {
    // grey score + high overdue + bad on_time → reductionFactor set to 0.25
    const result = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 75,
      days_over_90: 60_000,
      credit_score: 30, // 20-40 = grey
      on_time_rate: 0.5,
    });
    expect(result.action).toBe("reduce");
    expect(result.reduction_pct).toBeGreaterThanOrEqual(25);
  });

  it("includes rationale in all reduce proposals", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      days_over_90: 80_000,
      utilization_pct: 80,
      credit_score: 15,
    });
    expect(result.rationale.length).toBeGreaterThan(10);
  });

  it("credit_score null + high util + high overdue → triggers on AR metrics alone", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 80,
      days_over_90: 80_000,
      credit_score: null,
    });
    expect(result.action).toBe("reduce");
    expect(result.reduction_pct).toBeGreaterThanOrEqual(25);
  });

  it("credit_score 50 (safe zone) + high overdue → uses AR metrics only, no distress penalty", () => {
    const safe = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 80,
      days_over_90: 80_000,
      credit_score: 50, // > 40 = safe, no zone penalty
    });
    const distress = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 80,
      days_over_90: 80_000,
      credit_score: 10, // < 20 = distress
    });
    // Safe score should result in smaller reduction than distress
    expect(safe.reduction_pct).toBeLessThan(distress.reduction_pct);
  });

  it("poor payer (on_time_rate 0.40) lowers util threshold — 60% util triggers action", () => {
    // paymentPenalty=15 → highUtilThreshold=55; without penalty 60% would not trigger
    const result = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 60,
      days_over_90: 60_000, // 60k > 500k*10%=50k → highOverdue true
      on_time_rate: 0.40,
      credit_score: null,
    });
    expect(result.action).toBe("reduce");
  });

  it("good payer (on_time_rate 0.90) at 72% util → no action (threshold stays at 70%)", () => {
    // paymentPenalty=0 → highUtilThreshold=70; highUtil=true but no highOverdue → no branch fires
    const result = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 72,
      days_over_90: 0, // no overdue → highOverdue false
      on_time_rate: 0.90,
      credit_score: null,
    });
    expect(result.action).toBe("no_action");
  });

  it("relative overdue: $1M limit + $80K over 90d → highOverdue false (8% < 10%)", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 1_000_000,
      current_exposure: 800_000,
      utilization_pct: 80,
      days_over_90: 80_000, // 80k < 1M*10%=100k → highOverdue false
      credit_score: null,
    });
    expect(result.action).toBe("no_action");
  });

  it("relative overdue: $500K limit + $60K over 90d → highOverdue true (12% > 10%)", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 500_000,
      current_exposure: 400_000,
      utilization_pct: 80,
      days_over_90: 60_000, // 60k > 500k*10%=50k → highOverdue true
      credit_score: null,
    });
    expect(result.action).toBe("reduce");
  });
});
