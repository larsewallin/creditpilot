import { describe, it, expect } from "vitest";
import { calculateCreditLimitProposal, MAX_REDUCTION_USD } from "../calculate-credit-limit-proposal";
import { POLICY_DEFAULTS } from "../../../policy/defaults";

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

  it("one limit-use rule: acts at the threshold assess-composite-risk passes in (strategic gets its group's higher one)", () => {
    // Founder 2026-11-23: the proposal keeps no thresholds of its own.
    const atDefault = calculateCreditLimitProposal({ ...BASE, utilization_pct: 76, days_over_90: 60_000, credit_score: null, action_threshold_pct: 75 });
    const strategic = calculateCreditLimitProposal({ ...BASE, utilization_pct: 76, days_over_90: 60_000, credit_score: null, is_strategic_account: true, action_threshold_pct: 85 });
    expect(atDefault.action).toBe("reduce");
    expect(strategic.action).toBe("no_action");
  });

  it("grey score + high overdue + bad on_time rate still reduces at >=25% (highUtil&&highOverdue branch, not a separate floor rule)", () => {
    // The flat "minimum 25% reduction" floor was removed 2026-10-01 (see F4 in the
    // deferred backlog) — every branch already sets its own explicit factor, so there's
    // nothing left for a generic floor to enforce. This exact input actually lands on the
    // highUtil && highOverdue branch (30% for non-strategic), not the inGrey branch (25%):
    // on_time_rate 0.5 gives a 10pp payment penalty, so criticalUtilThreshold becomes 75 and
    // 75% utilization doesn't clear it (not criticalUtil), but it does clear the 60%
    // highUtilThreshold — and that branch is checked first. Kept as >=25 (not an exact
    // value) so this test isn't coupled to exactly which qualifying branch fires.
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

  it("poor payer: the lower threshold from assess-composite-risk (75 − 15 = 60) triggers action at 60%", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      action_threshold_pct: 60,
      utilization_pct: 60,
      days_over_90: 60_000, // 60k > 500k*10%=50k → highOverdue true
      on_time_rate: 0.40,
      credit_score: null,
    });
    expect(result.action).toBe("reduce");
  });

  it("good payer at 80% util, nothing overdue, no weak score → no action (no tier fits)", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      utilization_pct: 80,
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

  // --- F4: new no-overdue-required branch (critical utilization + weak score/payment history) ---

  it("F4: critical utilization + grey score + no overdue (Atlas-style case) now triggers reduce, not no_action", () => {
    // Reproduces the originally-reported gap: Atlas Precision Manufacturing — 109%
    // utilization, credit_score 32 (grey), on_time_rate 0.24, zero days_over_90.
    // Previously fell through every branch (all require highOverdue except the
    // credit_score<20 distress branches) and returned no_action.
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 2_000_000,
      current_exposure: 2_180_000,
      utilization_pct: 109,
      days_over_90: 0,
      credit_score: 32, // grey
      on_time_rate: 0.24,
    });
    expect(result.action).toBe("reduce");
    expect(result.reduction_pct).toBeGreaterThan(0);
  });

  it("F4: critical utilization + safe score but very poor on-time rate (<0.5) also triggers reduce via the on_time_rate leg", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 2_000_000,
      current_exposure: 2_180_000,
      utilization_pct: 95, // critical even with a 0 payment penalty threshold of 85
      days_over_90: 0,
      credit_score: 55, // safe zone, not grey/distress
      on_time_rate: 0.30, // < 0.5
    });
    expect(result.action).toBe("reduce");
  });

  it("F4: limit use below the customer's action level + grey score + no overdue returns no_action", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 2_000_000,
      current_exposure: 1_400_000,
      action_threshold_pct: 75,
      utilization_pct: 70, // below the action level
      days_over_90: 0,
      credit_score: 32, // grey
      on_time_rate: 0.95, // good payer, no penalty
    });
    expect(result.action).toBe("no_action");
  });

  it("F4: strategic account gets a smaller (15%) reduction than non-strategic (20%) on the new branch", () => {
    const nonStrategic = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 2_000_000,
      current_exposure: 2_180_000,
      utilization_pct: 109,
      days_over_90: 0,
      credit_score: 32,
      on_time_rate: 0.24,
      is_strategic_account: false,
    });
    const strategic = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 2_000_000,
      current_exposure: 2_180_000,
      utilization_pct: 109,
      days_over_90: 0,
      credit_score: 32,
      on_time_rate: 0.24,
      is_strategic_account: true,
    });
    expect(nonStrategic.reduction_pct).toBe(20);
    expect(strategic.reduction_pct).toBe(15);
  });

  // --- F4: absolute dollar cap on reduction amount ---

  it("F4: dollar cap binds for a large account — 50% of $8M (distress+overdue) is capped to $1M, not $4M", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 8_000_000,
      current_exposure: 7_000_000,
      utilization_pct: 90,
      days_over_90: 1_000_000, // > 10% of 8M
      credit_score: 15, // distress → 50% factor for non-strategic
      on_time_rate: 1,
    });
    expect(result.action).toBe("reduce");
    expect(result.proposed_limit).toBe(8_000_000 - MAX_REDUCTION_USD);
    expect(result.reduction_pct).toBe(Math.round((MAX_REDUCTION_USD / 8_000_000) * 100));
    expect(result.rationale).toContain("capped");
  });

  it("F4: dollar cap does not bind for a median-sized account — 30% of $1.5M ($450K) stays uncapped", () => {
    // on_time_rate 0.5 gives a 10pp payment penalty (>= 0.50 doesn't hit the <0.50 tier),
    // so highUtilThreshold=60/criticalUtilThreshold=75 — 75% utilization clears highUtil
    // (>60) but not criticalUtil (75 is not >75), so this lands on the
    // highUtil && highOverdue branch (30% non-strategic), not the grey-score branch.
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 1_500_000,
      current_exposure: 1_300_000,
      utilization_pct: 75,
      days_over_90: 200_000, // > 10% of 1.5M
      credit_score: 30, // grey
      on_time_rate: 0.5,
    });
    expect(result.action).toBe("reduce");
    expect(result.reduction_pct).toBe(30);
    expect(result.proposed_limit).toBe(1_500_000 - 450_000);
    expect(result.rationale).not.toContain("capped");
  });

  it("F4: dollar cap does not bind for the smallest accounts — 50% of $150K ($75K) is far under the $1M cap", () => {
    const result = calculateCreditLimitProposal({
      ...BASE,
      current_limit: 150_000,
      current_exposure: 140_000,
      utilization_pct: 90,
      days_over_90: 20_000, // > 10% of 150K
      credit_score: 15, // distress
      on_time_rate: 1,
    });
    expect(result.action).toBe("reduce");
    expect(result.reduction_pct).toBe(50);
    expect(result.proposed_limit).toBe(75_000);
    expect(result.rationale).not.toContain("capped");
  });
});

describe("customer in bankruptcy (founder, 2026-11-21)", () => {
  it("holds the limit at $0 whatever the score, limit use or caps", () => {
    const p = calculateCreditLimitProposal({ current_limit: 1_200_000, current_exposure: 1_080_000, days_over_90: 0, utilization_pct: 90, credit_score: 28, pre_petition_usd: 580_000 });
    expect(p.action).toBe("reduce");
    expect(p.proposed_limit).toBe(0);
    expect(p.reduction_pct).toBe(100);
    expect(p.rationale).toContain("$580,000");
    expect(p.rationale).toMatch(/no new credit/);
  });
  it("is not applied without a pre-petition balance", () => {
    const p = calculateCreditLimitProposal({ current_limit: 1_200_000, current_exposure: 100_000, days_over_90: 0, utilization_pct: 8, credit_score: 80 });
    expect(p.action).toBe("no_action");
  });
});

describe("a new limit below the balance says what it means (founder 2026-11-23)", () => {
  it("states the amount owed, the hold on new orders and what to collect first", () => {
    const r = calculateCreditLimitProposal({
      current_limit: 750_000, current_exposure: 929_500, days_over_90: 0, utilization_pct: 123.93,
      credit_score: 41, on_time_rate: 0.07, action_threshold_pct: 60,
    });
    expect(r.action).toBe("reduce");
    expect(r.proposed_limit).toBe(600_000);
    expect(r.rationale).toContain("Over the limit (124% in use)");
    expect(r.rationale).not.toContain("early-warning");
    expect(r.rationale).toContain("The new limit is below the $929,500 owed: no new orders until the balance is under $600,000 ($329,500 to collect first).");
  });

  it("says nothing extra when the new limit is above the balance", () => {
    const r = calculateCreditLimitProposal({
      current_limit: 500_000, current_exposure: 300_000, days_over_90: 60_000, utilization_pct: 80,
      credit_score: null, on_time_rate: 1, action_threshold_pct: 75,
    });
    expect(r.action).toBe("reduce");
    expect(r.rationale).not.toContain("no new orders");
  });
});

describe("new limits are round numbers (review 2026-11-23)", () => {
  it("rounds a 15% strategic cut of $3,975,000 to $3,375,000", () => {
    const r = calculateCreditLimitProposal({
      current_limit: 3_975_000, current_exposure: 3_263_000, days_over_90: 0, utilization_pct: 82.1,
      credit_score: 64, on_time_rate: 0.42, is_strategic_account: true, action_threshold_pct: 70,
    }, { ...POLICY_DEFAULTS.limit_review, max_reduction_pct: 20 });
    expect(r.proposed_limit).toBe(3_375_000);
    expect(r.reduction_pct).toBe(15);
  });
});
