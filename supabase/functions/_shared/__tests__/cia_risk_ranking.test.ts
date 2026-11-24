import { describe, it, expect } from "vitest";
import { rankPortfolioRisk, type RiskCustomer } from "../cia_risk_ranking";

const cust = (id: string, name: string, limit: number, exposure: number, score: number | null, extra: Partial<RiskCustomer> = {}): RiskCustomer => ({
  id, company_name: name, credit_limit: limit, current_exposure: exposure, credit_rating_score: score,
  payment_on_time_rate: 1, payment_trend: "stable", payment_health: "good", ...extra,
});
const rules = { distress_score_below: 25, at_risk_on_time_below: 0.85 };

describe("rankPortfolioRisk (review 2026-11-23: by seriousness, with reasons, not by size)", () => {
  const customers = [
    cust("lark", "Larkspur", 3_975_000, 3_263_000, 64, { payment_on_time_rate: 0.42, payment_trend: "deteriorating", payment_health: "at_risk" }),
    cust("carr", "Carrick", 750_000, 929_500, 41, { payment_on_time_rate: 0.08, payment_trend: "deteriorating", payment_health: "at_risk" }),
    cust("brig", "Brightwater", 625_000, 498_500, 6),
    cust("sole", "Solenne", 400_000, 290_500, 21),
    cust("pell", "Pellham", 250_000, 279_500, 61),
    cust("gran", "Granitefold", 475_000, 267_500, 54),
    cust("half", "Halvorsen", 3_075_000, 1_688_500, 81),
  ];
  const events = [
    { customer_id: "sole", event_type: "GOING_CONCERN", severity: "critical", title: "Going-concern doubt" },
    { customer_id: "gran", event_type: "SEC_OTHER", severity: "high", title: "Covenant waiver disclosed in 10-Q filing" },
    { customer_id: "gran", event_type: "SEC_OTHER", severity: "medium", title: "Notable item flagged in 8-K filing" },
    { customer_id: "pell", event_type: "UTILIZATION_THRESHOLD_BREACH", severity: "critical", title: "Credit utilization at 111.8%" },
  ];
  const pending = [
    { company_name: "Larkspur", action_type: "credit_limit_reduction", current_value: 3_975_000, proposed_value: 3_375_000, severity: "high" },
    { company_name: "Carrick", action_type: "credit_limit_reduction", current_value: "750000", proposed_value: "600000", severity: "critical" },
    { company_name: "Brightwater", action_type: "credit_limit_reduction", current_value: 625_000, proposed_value: 0, severity: "critical" },
    { company_name: "Solenne", action_type: "credit_limit_reduction", current_value: 400_000, proposed_value: 295_000, severity: "critical" },
  ];
  const r = rankPortfolioRisk(customers, events, pending, [{ company_name: "Brightwater", pre_petition: 498_500 }], rules);
  const names = r.map((x) => x.customer.company_name);

  it("puts bankruptcy first, then High risk / going concern, then cuts (most severe first), then watch", () => {
    expect(names).toEqual(["Brightwater", "Solenne", "Carrick", "Larkspur", "Pellham", "Granitefold"]);
    expect(r.map((x) => x.tier)).toEqual([1, 2, 3, 3, 4, 4]);
  });
  it("gives each customer its reasons", () => {
    expect(r[0].reasons[0]).toBe("in bankruptcy; $498,500 owed from before the filing");
    expect(r[1].reasons).toContain("going-concern doubt in its filings");
    expect(r[2].reasons).toContain("limit cut proposed ($750,000 → $600,000)");
    expect(r[2].reasons).toContain("over its limit (124% in use)");
    expect(r.find((x) => x.customer.company_name === "Granitefold")!.reasons).toContain("covenant waiver in its filings");
    expect(r.find((x) => x.customer.company_name === "Pellham")!.reasons).toEqual(["over its limit (112% in use)"]);
  });
  it("leaves out a large, healthy customer", () => {
    expect(names).not.toContain("Halvorsen");
  });
});
