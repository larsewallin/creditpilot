import { describe, expect, it } from "vitest";
import { requiredTradeReferences } from "../../onboarding/trade_references.ts";
import { ONBOARDING_DEFAULTS } from "../../onboarding/settings.ts";

const rule = ONBOARDING_DEFAULTS.template.trade_references;

describe("requiredTradeReferences (policy: by size and score)", () => {
  it("asks a large company for none", () => {
    expect(requiredTradeReferences(rule, 2_000_000_000, "adequate")).toBe(0);
  });
  it("asks a mid-size company for 2, 1 if Strong or better", () => {
    expect(requiredTradeReferences(rule, 100_000_000, "watch")).toBe(2);
    expect(requiredTradeReferences(rule, 100_000_000, "strong")).toBe(1);
  });
  it("asks a small or unknown-size company for 3, 2 if Strong or better", () => {
    expect(requiredTradeReferences(rule, 5_000_000, null)).toBe(3);
    expect(requiredTradeReferences(rule, undefined, "very_strong")).toBe(2);
  });
});
