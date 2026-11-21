import { describe, expect, it } from "vitest";
import { describePolicy } from "../describe.ts";
import { effectiveGroups, effectivePolicy } from "../policy.ts";

describe("describePolicy", () => {
  it("states the company's values, not the defaults", () => {
    const text = describePolicy(effectivePolicy({ "policy.payments": { grace_days: 7 } }), effectiveGroups());
    expect(text).toContain("within 7 days of its due date counts as on time");
    expect(text).toContain("no alert below $1,000 or 2% of the limit");
    expect(text).toContain("1–30 days low, 31–60 medium, 61–90 high");
    expect(text).toContain("- Strategic:");
  });
});
