import { describe, expect, it } from "vitest";
import { effectiveGroups, effectivePolicy } from "../policy.ts";
import { previewPolicyChange } from "../preview.ts";

const base = { policy: effectivePolicy(), groups: effectiveGroups() };
const cust = (o: Record<string, unknown> = {}) => ({
  id: "c1", company_name: "Acme", credit_limit: 100_000, current_exposure: 50_000,
  credit_rating_score: 70, payment_terms_days: 30, policy_group: null, ...o,
});
const pay = (date: string, late: number) => ({ customer_id: "c1", payment_date: date, days_to_pay: 30 + late, days_early_late: late, on_time: late <= 0, amount: 1000 });
const today = "2026-11-20";

describe("previewPolicyChange", () => {
  it("finds nothing when the policy does not change", () => {
    const data = { customers: [cust()], transactions: [pay("2026-10-01", 3)], invoices: [], today };
    expect(previewPolicyChange(data, base, base)).toEqual([]);
  });

  it("shows payment health moving when grace days change", () => {
    const tx = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((d) => pay(d, 4));
    const after = { ...base, policy: effectivePolicy({ "policy.payments": { grace_days: 0 } }) };
    const changes = previewPolicyChange({ customers: [cust()], transactions: tx, invoices: [], today }, base, after);
    expect(changes).toEqual([{ customer_id: "c1", company_name: "Acme", rule: "Payment health", before: "healthy", after: "watch" }]);
  });

  it("shows an overdue alert disappearing below a higher minimum", () => {
    const inv = [{ customer_id: "c1", amount_outstanding: 1_500, due_date: "2026-11-01", status: "open" }];
    const after = { ...base, policy: effectivePolicy({ "policy.overdue": { materiality_usd: 2_000 } }) };
    const [c] = previewPolicyChange({ customers: [cust({ credit_limit: 10_000, current_exposure: 5_000 })], transactions: [], invoices: inv, today }, base, after);
    expect(c).toMatchObject({ rule: "Overdue alert", before: "low", after: "none (below the minimum)" });
  });

  it("applies a customer's group", () => {
    const c = cust({ current_exposure: 75_000, credit_rating_score: 50, policy_group: "high_risk" });
    const noGroups = { ...base, groups: {} };
    const [ch] = previewPolicyChange({ customers: [c], transactions: [], invoices: [], today }, noGroups, base);
    expect(ch).toMatchObject({ rule: "Limit-use alert", before: "none", after: "high" });
  });
});
