import { describe, expect, it } from "vitest";
import { buildCharts } from "../../../cia_charts.ts";

describe("CIA charts", () => {
  it("a named customer: payment trend and limit use, computed from the rows", () => {
    const charts = buildCharts({
      question: "How does Arconic pay?",
      companyMentions: ["Arconic"],
      customers: [{ company_name: "Arconic Corp", current_exposure: 2_760_000, credit_limit: 3_000_000 }],
      payment_trend_named: [{ company_name: "Arconic Corp", prior_avg_days_late: 20.04, current_avg_days_late: 40.3, payment_terms_days: 45 }],
    });
    expect(charts).toHaveLength(2);
    expect(charts[0].rows.map((r) => [r.display, r.tone])).toEqual([["20 days", "neutral"], ["40.3 days", "bad"]]);
    expect(charts[1].rows[0].display).toBe("$2,760,000 (92%)");
  });
  it("portfolio aging for an overdue question; nothing for a question no chart fits", () => {
    const aging = { total_current: 10, total_1_30: 5, total_31_60: 0, total_61_90: 0, total_over_90: 2 };
    expect(buildCharts({ question: "What is our total overdue AR?", companyMentions: [], ar_aging_portfolio_summary: aging })[0].rows.map((r) => r.value)).toEqual([10, 5, 0, 0, 2]);
    expect(buildCharts({ question: "Who is the account manager for Kaman?", companyMentions: ["Kaman"] })).toEqual([]);
  });
  it("whose payments are getting worse: the worst first, at most 8", () => {
    const pt = Array.from({ length: 10 }, (_, i) => ({ company_name: `C${i}`, delta_days_late: i + 1, deterioration_severity: "high" }));
    const c = buildCharts({ question: "Whose payments are getting worse?", companyMentions: [], payment_trend: pt })[0];
    expect(c.rows).toHaveLength(8);
    expect(c.rows[0].label).toBe("C9");
  });
});
