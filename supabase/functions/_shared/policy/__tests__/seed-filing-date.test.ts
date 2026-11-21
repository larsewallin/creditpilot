import { describe, expect, it } from "vitest";
import { rollSeedFilingDate } from "../../skills/integration/fetch-sec-filing.ts";

describe("demo seed filing dates", () => {
  it("end 10 days before today and keep their spacing", () => {
    const today = new Date("2026-11-21T12:00:00Z");
    expect(rollSeedFilingDate("2025-03-27", today)).toBe("2026-11-11");
    expect(rollSeedFilingDate("2025-02-06", today)).toBe("2026-09-23") // 49 days before the newest, as in the seed;
  });
});
