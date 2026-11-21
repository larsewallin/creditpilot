import { describe, expect, it } from "vitest";
import { plainSecText } from "./secSignalLabels";
import { plainSecText as backend } from "../../supabase/functions/_shared/sec_signal_labels";

describe("plainSecText", () => {
  it("turns signal codes into words", () => {
    expect(plainSecText("Risk signals in 10-K (2025-03-27): going_concern_warning, cash_runway_<3_quarters"))
      .toBe("Warning signs in its 10-K (2025-03-27): doubt about its ability to continue (going concern), cash for under three quarters");
  });
  it("leaves other text alone and matches the agents' copy", () => {
    expect(plainSecText("Credit utilization at 90%")).toBe("Credit utilization at 90%");
    expect(plainSecText("x covenant_waiver")).toBe(backend("x covenant_waiver"));
  });
});
