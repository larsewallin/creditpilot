import { describe, it, expect } from "vitest";
import { detectRiskSignals, fetchSecFilings } from "../fetch-sec-filing";

describe("detectRiskSignals", () => {
  it("going concern text → returns going_concern_warning", () => {
    const result = detectRiskSignals(
      "There is substantial doubt about the company's ability to continue as a going concern."
    );
    expect(result).toContain("going_concern_warning");
  });

  it("covenant waiver text → returns covenant_waiver", () => {
    const result = detectRiskSignals(
      "The company obtained a covenant waiver from its lenders in Q3."
    );
    expect(result).toContain("covenant_waiver");
  });

  it("clean text → returns empty array", () => {
    const result = detectRiskSignals(
      "The company reported strong revenue growth and increased cash flow from operations."
    );
    expect(result).toHaveLength(0);
  });

  it("multiple signals → returns all detected signals", () => {
    const result = detectRiskSignals(
      "Material weakness identified in internal controls. The CEO resigned effective immediately. " +
      "There is substantial doubt about the ability to continue as a going concern."
    );
    expect(result).toContain("material_weakness");
    expect(result).toContain("CEO_departure");
    expect(result).toContain("going_concern_warning");
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

describe("fetchSecFilings", () => {
  it("empty providers array → returns []", async () => {
    const result = await fetchSecFilings({
      cik: "1021162",
      company_name: "Triumph Group",
      providers: [],
    });
    expect(result).toEqual([]);
  });
});
