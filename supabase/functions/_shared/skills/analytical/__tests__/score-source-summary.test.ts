import { describe, it, expect } from "vitest";
import { summarizeScoreSources, scoreSourceBlocks } from "../score-source-summary.ts";
import { ONBOARDING_DEFAULTS } from "../../../onboarding/settings.ts";

const F = ONBOARDING_DEFAULTS.financials;
const rows = [
  { company_name: "A", credit_rating_score: 80, credit_rating_source: "sp" },
  { company_name: "B", credit_rating_score: 45, credit_rating_source: "sp", financials_fye: "2025-12-31" },
  { company_name: "C", credit_rating_score: 62, credit_rating_source: "keen", financials_fye: "2025-12-31" },
  { company_name: "D", credit_rating_score: 85, credit_rating_source: "keen", financials_fye: "2025-12-31" },
  { company_name: "E", credit_rating_score: null, credit_rating_source: null },
];

describe("summarizeScoreSources", () => {
  it("counts sources and lists out-of-date and due-soon accounts, worst first", () => {
    const s = summarizeScoreSources(rows, F, "2026-11-14");
    expect(s.customers).toBe(5);
    expect(s.by_source).toEqual([{ source: "keen", label: "Keen", count: 2 }, { source: "sp", label: "S&P", count: 2 }]);
    expect(s.no_score).toBe(1);
    expect(s.with_year_end).toBe(3);
    expect(s.accounts).toEqual([
      { company_name: "B", fye: "2025-12-31", months: 10, max_months: 9, status: "stale" },
      { company_name: "C", fye: "2025-12-31", months: 10, max_months: 12, status: "due_soon" },
    ]);
  });
  it("says plainly when no year end is recorded", () => {
    const [src, acc] = scoreSourceBlocks(summarizeScoreSources(rows.slice(0, 1), F, "2026-11-14"));
    expect(src).toMatch(/Scored by S&P: 1/);
    expect(acc).toMatch(/No financial year end is recorded/);
  });
});
