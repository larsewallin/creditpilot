import { describe, expect, it } from "vitest";
import { POLICY_DEFAULTS } from "../defaults.ts";
import { effectivePolicy, loadPolicy } from "../policy.ts";
import { effectiveSettings, validateSetting } from "../../onboarding/settings_validate.ts";
import { analysePaymentBehaviour } from "../../skills/analytical/analyse-payment-behaviour.ts";
import { analysePaymentTrend } from "../../skills/analytical/analyse-payment-trend.ts";
import { detectRatingChange } from "../../skills/analytical/detect-rating-change.ts";
import { calculateCreditLimitProposal } from "../../skills/analytical/calculate-credit-limit-proposal.ts";
import { assessCompositeRisk } from "../../skills/analytical/assess-composite-risk.ts";

describe("effectivePolicy", () => {
  it("is the defaults with no overrides", () => {
    expect(effectivePolicy()).toEqual(POLICY_DEFAULTS);
  });

  it("applies a company override and keeps the other values", () => {
    const p = effectivePolicy({ "policy.payments": { grace_days: 5 } });
    expect(p.payments.grace_days).toBe(5);
    expect(p.payments.trend_days).toBe(POLICY_DEFAULTS.payments.trend_days);
    expect(p.overdue).toEqual(POLICY_DEFAULTS.overdue);
  });

  it("ignores unknown fields and values of the wrong type", () => {
    const p = effectivePolicy({ "policy.payments": { grace_days: "5", nonsense: 1 } });
    expect(p.payments.grace_days).toBe(0);
    expect("nonsense" in p.payments).toBe(false);
  });
});

describe("loadPolicy", () => {
  const db = (result: { data?: unknown; error?: { message: string } }) => ({
    from: () => ({ select: () => ({ like: async () => result }) }),
  });

  it("reads policy.* rows", async () => {
    const { policy, warning } = await loadPolicy(db({ data: [{ key: "policy.utilization", value: { high_pct: 70 } }] }));
    expect(policy.utilization.high_pct).toBe(70);
    expect(warning).toBeUndefined();
  });

  it("falls back to the defaults on a read error and says so", async () => {
    const { policy, warning } = await loadPolicy(db({ error: { message: "boom" } }));
    expect(policy).toEqual(POLICY_DEFAULTS);
    expect(warning).toMatch(/defaults used/);
  });
});

describe("settings validation for policy keys", () => {
  it("accepts a known field", () => {
    expect(validateSetting("policy.overdue", { materiality_usd: 1000 })).toEqual([]);
  });
  it("rejects an unknown field, a negative number and an unknown section", () => {
    expect(validateSetting("policy.overdue", { minimum: 1 })[0]).toMatch(/unknown setting/);
    expect(validateSetting("policy.overdue", { materiality_usd: -1 })[0]).toMatch(/>= 0/);
    expect(validateSetting("policy.nope", {})[0]).toMatch(/unknown settings key/);
  });
  it("shows the effective policy with the other settings", () => {
    const s = effectiveSettings({ "policy.utilization": { high_pct: 75 } }) as { policy: typeof POLICY_DEFAULTS };
    expect(s.policy.utilization.high_pct).toBe(75);
  });
});

describe("skills follow the policy", () => {
  it("grace days turn a 3-day-late payment into an on-time one", () => {
    const tx = [{ payment_date: "2026-10-01", days_to_pay: 33, days_early_late: 3, on_time: false, amount: 100 }];
    expect(analysePaymentBehaviour(tx).on_time_rate).toBe(0);
    expect(analysePaymentBehaviour(tx, { ...POLICY_DEFAULTS.payments, grace_days: 5 }).on_time_rate).toBe(1);
  });

  it("a stricter trend swing raises a deterioration the default does not", () => {
    const ref = new Date("2026-11-20T00:00:00Z");
    const tx = [
      { payment_date: "2026-07-15", days_early_late: 2 },
      { payment_date: "2026-10-15", days_early_late: 5 },
    ];
    const def = analysePaymentTrend(tx, ref);
    const strict = analysePaymentTrend(tx, ref, { ...POLICY_DEFAULTS.payment_trend, swing_days: 3 });
    expect(def.has_sufficient_data && def.deterioration).toBeNull();
    expect(strict.has_sufficient_data && strict.deterioration?.severity).toBe("medium");
  });

  it("score change thresholds come from the policy", () => {
    expect(detectRatingChange(60, 52).severity).toBe("low");
    expect(detectRatingChange(60, 52, { ...POLICY_DEFAULTS.score_change, medium_from: 8 }).severity).toBe("medium");
  });

  it("the limit-review dollar cap comes from the policy", () => {
    const input = { current_limit: 10_000_000, current_exposure: 9_000_000, days_over_90: 2_000_000, utilization_pct: 90, credit_score: 10 };
    expect(calculateCreditLimitProposal(input).proposed_limit).toBe(9_000_000);
    expect(calculateCreditLimitProposal(input, { ...POLICY_DEFAULTS.limit_review, max_reduction_usd: 500_000 }).proposed_limit).toBe(9_500_000);
  });

  it("composite weights come from the policy", () => {
    const input = { utilization_pct: 50, active_event_types: ["GOING_CONCERN"], agents_flagging: ["sec"] };
    expect(assessCompositeRisk(input).adjusted_threshold).toBe(60);
    expect(assessCompositeRisk(input, { ...POLICY_DEFAULTS.composite, going_concern_pts: 30 }).adjusted_threshold).toBe(45);
  });
});
