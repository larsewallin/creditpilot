import { describe, expect, it } from "vitest";
import { DEMO_ANSWERS } from "@/lib/demoAnswers";

describe("demo CIA fixed answers", () => {
  it("carry no calendar dates (the demo replays daily with today's dates)", () => {
    for (const [q, a] of Object.entries(DEMO_ANSWERS)) {
      expect(JSON.stringify(a), q).not.toMatch(/20\d\d-\d\d-\d\d/);
      for (const s of a.sources) expect(s.static, q).toBe(true);
    }
  });
});
