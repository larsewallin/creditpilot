import { describe, expect, it } from "vitest";
import { lastDemoRefresh } from "../../../demo_refresh_time.ts";

describe("lastDemoRefresh", () => {
  it("is 04:00 New York today after 04:00, yesterday before", () => {
    // 2026-11-19 10:59 New York (EST, UTC-5) -> 2026-11-19 09:00 UTC
    expect(lastDemoRefresh(new Date("2026-11-19T15:59:30Z")).toISOString()).toBe("2026-11-19T09:00:00.000Z");
    // 03:30 New York -> yesterday's 04:00
    expect(lastDemoRefresh(new Date("2026-11-19T08:30:00Z")).toISOString()).toBe("2026-11-18T09:00:00.000Z");
    // summer time (EDT, UTC-4)
    expect(lastDemoRefresh(new Date("2026-07-01T12:00:00Z")).toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
});
