import { describe, it, expect } from "vitest";
import { isRiskSignal } from "../../../risk_signals";

describe("isRiskSignal", () => {
  it("counts warnings, not good news or info", () => {
    expect(isRiskSignal({ event_type: "PAYMENT_DETERIORATION", severity: "high" })).toBe(true);
    expect(isRiskSignal({ event_type: "PAYMENT_IMPROVEMENT", severity: "low" })).toBe(false);
    expect(isRiskSignal({ event_type: "CREDIT_RATING_UPGRADE", severity: "medium" })).toBe(false);
    expect(isRiskSignal({ event_type: "CURRENCY_VOLATILITY", severity: "info" })).toBe(false);
  });
});
