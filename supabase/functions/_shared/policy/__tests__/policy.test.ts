import { describe, expect, it } from "vitest";
import { POLICY_DEFAULTS } from "../defaults.ts";
import { effectiveGroups, effectivePolicy, loadPolicy, policyFor } from "../policy.ts";
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
    const p = effectivePolicy({ "policy.payments": { grace_days: 3 } });
    expect(p.payments.grace_days).toBe(3);
    expect(p.payments.trend_pct_of_terms).toBe(POLICY_DEFAULTS.payments.trend_pct_of_terms);
    expect(p.overdue).toEqual(POLICY_DEFAULTS.overdue);
  });

  it("ignores unknown fields and values of the wrong type", () => {
    const p = effectivePolicy({ "policy.payments": { grace_days: "9", nonsense: 1 } });
    expect(p.payments.grace_days).toBe(POLICY_DEFAULTS.payments.grace_days);
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
  it("grace days decide whether a 3-day-late payment is on time", () => {
    const tx = [{ payment_date: "2026-10-01", days_to_pay: 33, days_early_late: 3, on_time: false, amount: 100 }];
    expect(analysePaymentBehaviour(tx).on_time_rate).toBe(1);
    expect(analysePaymentBehaviour(tx, { ...POLICY_DEFAULTS.payments, grace_days: 0 }).on_time_rate).toBe(0);
  });

  it("trend swings are a share of the customer's terms", () => {
    const ref = new Date("2026-11-20T00:00:00Z");
    const tx = [
      { payment_date: "2026-07-15", days_early_late: 2 },
      { payment_date: "2026-10-15", days_early_late: 5 },
    ];
    // +3 days: under 15% of net 30 (4.5 days), over 15% of net 15 (2.25 days)
    const net30 = analysePaymentTrend(tx, ref, undefined, 30);
    const net15 = analysePaymentTrend(tx, ref, undefined, 15);
    expect(net30.has_sufficient_data && net30.deterioration).toBeNull();
    expect(net15.has_sufficient_data && net15.deterioration?.severity).toBe("medium");
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

describe("customer groups", () => {
  it("starts with Strategic, High risk and Export", () => {
    expect(Object.keys(effectiveGroups())).toEqual(["strategic", "high_risk", "export"]);
  });

  it("a group overrides only its own rules; no group means the company policy", () => {
    const company = effectivePolicy({ "policy.payments": { grace_days: 3 } });
    const groups = effectiveGroups();
    expect(policyFor(company, groups, null)).toBe(company);
    expect(policyFor(company, groups, "unknown")).toBe(company);
    const exp = policyFor(company, groups, "export");
    expect(exp.payments.grace_days).toBe(10);
    expect(exp.payments.watch_on_time_below).toBe(company.payments.watch_on_time_below);
    expect(exp.overdue).toEqual(company.overdue);
  });

  it("caps a Strategic customer's limit cut at 20%", () => {
    const rules = policyFor(effectivePolicy(), effectiveGroups(), "strategic").limit_review;
    const input = { current_limit: 1_000_000, current_exposure: 900_000, days_over_90: 200_000, utilization_pct: 98, credit_score: 10 };
    expect(calculateCreditLimitProposal(input).reduction_pct).toBe(50);
    expect(calculateCreditLimitProposal(input, rules).reduction_pct).toBe(20);
  });

  it("validates stored groups", () => {
    const ok = { vip: { name: "VIP", note: "", overrides: { payments: { grace_days: 7 } } } };
    expect(validateSetting("policy.groups", ok)).toEqual([]);
    expect(validateSetting("policy.groups", { "Bad Key": ok.vip })[0]).toMatch(/lowercase/);
    expect(validateSetting("policy.groups", { vip: { ...ok.vip, overrides: { nope: {} } } })[0]).toMatch(/unknown policy section/);
    expect(validateSetting("policy.groups", { vip: { ...ok.vip, overrides: { payments: { grace_days: -1 } } } })[0]).toMatch(/>= 0/);
  });

  it("uses the stored groups when the company has saved some", () => {
    const g = effectiveGroups({ "policy.groups": { vip: { name: "VIP", note: "", overrides: {} } } });
    expect(Object.keys(g)).toEqual(["vip"]);
  });
});

describe("High risk always gets a proposal (founder, 2026-11-21)", () => {
  it("cuts a High risk customer's limit to what it owes, even at low limit use", () => {
    const r = calculateCreditLimitProposal({ current_limit: 600_000, current_exposure: 298_000, days_over_90: 0, utilization_pct: 49.7, credit_score: 5 });
    expect(r.action).toBe("reduce");
    expect(r.proposed_limit).toBe(300_000);
    expect(r.rationale).toMatch(/stops new credit at High risk/);
  });
  it("never cuts more than the policy's largest single cut", () => {
    const r = calculateCreditLimitProposal({ current_limit: 600_000, current_exposure: 100_000, days_over_90: 0, utilization_pct: 17, credit_score: 5 });
    expect(r.proposed_limit).toBe(300_000);
    expect(r.rationale).toMatch(/largest single cut, 50%/);
  });
  it("leaves an Elevated score at low limit use alone", () => {
    expect(calculateCreditLimitProposal({ current_limit: 600_000, current_exposure: 100_000, days_over_90: 0, utilization_pct: 17, credit_score: 30 }).action).toBe("no_action");
  });
  it("explains the composite threshold in plain words", () => {
    const a = assessCompositeRisk({ utilization_pct: 90, credit_score: 60, on_time_rate: 0.3, active_event_types: ["PAYMENT_BEHAVIOUR"], agents_flagging: ["payment_behaviour_agent", "ar_aging_agent"] });
    expect(a.rationale).toBe("90% of the limit is in use. The policy acts from 75% limit use, and from 60% for this customer because of paying on time less than half the time (15 points lower). 2 monitors flag it: payments and AR aging.");
  });
});
