import { describe, expect, it } from "vitest";
import { gradeFromCitations } from "../cia_confidence";

const base = { cited: 0, verified: 0, web: 0, computedList: false, noData: false, hasFigures: false };
describe("gradeFromCitations", () => {
  it("every citation verified: High", () => expect(gradeFromCitations({ ...base, cited: 3, verified: 3, hasFigures: true }).confidence).toBe("High"));
  it("a citation with no record: Medium", () => expect(gradeFromCitations({ ...base, cited: 3, verified: 2, hasFigures: true }).confidence).toBe("Medium"));
  it("a list computed in code: High", () => expect(gradeFromCitations({ ...base, computedList: true, hasFigures: true }).confidence).toBe("High"));
  it("no data: Low", () => expect(gradeFromCitations({ ...base, noData: true }).confidence).toBe("Low"));
  it("figures without citations: Medium", () => expect(gradeFromCitations({ ...base, hasFigures: true }).confidence).toBe("Medium"));
  it("reasons never name internal sections", () => {
    for (const a of [base, { ...base, noData: true }, { ...base, cited: 1, verified: 1 }, { ...base, computedList: true }])
      expect(gradeFromCitations(a).confidence_reason).not.toMatch(/OFFICIAL|TABLE|tier/);
  });
});
