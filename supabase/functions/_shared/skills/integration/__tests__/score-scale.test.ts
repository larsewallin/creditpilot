import { describe, expect, it } from "vitest";
import { scoreBand } from "../../../score_scale.ts";

describe("score scale", () => {
  it("reads scores on Keen's labels", () => {
    expect(scoreBand(58)?.label).toBe("Adequate");
    expect(scoreBand(70)?.label).toBe("Strong");
    expect(scoreBand(54)?.label).toBe("Watch");
    expect(scoreBand(24)?.label).toBe("High risk");
    expect(scoreBand(null)).toBeNull();
  });
});
