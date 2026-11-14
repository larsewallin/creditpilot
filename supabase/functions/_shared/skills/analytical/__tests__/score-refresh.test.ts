import { describe, it, expect } from "vitest";
import { keenMayReplace, refreshDue, scoreUpdate } from "../score-refresh.ts";

const order = ["keen", "dnb", "creditsafe", "coface", "allianz_trade", "experian", "other", "bureau_report"];
const now = new Date("2026-11-14T04:00:00Z");
const c = (o: Record<string, unknown> = {}) => ({ id: "c1", credit_rating_score: 70, credit_rating_source: "keen", credit_rating_updated_at: "2026-10-01T00:00:00Z", credit_rating_checked_at: "2026-11-01T00:00:00Z", ...o });

describe("keenMayReplace", () => {
  it("Keen first: replaces any source; a provider ranked above Keen is kept", () => {
    expect(keenMayReplace("dnb", order)).toBe(true);
    expect(keenMayReplace(null, order)).toBe(true);
    expect(keenMayReplace("sp", order)).toBe(true);          // not in the order
    expect(keenMayReplace("allianz_trade", ["allianz_trade", "keen"])).toBe(false);
    expect(keenMayReplace("keen", ["allianz_trade", "keen"])).toBe(true);
    expect(keenMayReplace("dnb", ["dnb"])).toBe(false);      // Keen not used
  });
});

describe("refreshDue", () => {
  it("monthly, or after a new 10-K", () => {
    expect(refreshDue(c(), now)).toBe(false);
    expect(refreshDue(c({ credit_rating_checked_at: "2026-10-01T00:00:00Z" }), now)).toBe(true);
    expect(refreshDue(c({ credit_rating_checked_at: null, credit_rating_updated_at: null }), now)).toBe(true);
    expect(refreshDue(c(), now, "2026-11-05")).toBe(true);
    expect(refreshDue(c(), now, "2026-10-20")).toBe(false);
  });
});

describe("scoreUpdate", () => {
  it("a new score moves previous and current, once", () => {
    expect(scoreUpdate(c(), { score: 61.6, label: "Adequate", as_of: "2026-09-26", from: "sec_10k" }, now)).toEqual({
      credit_rating_checked_at: now.toISOString(), financials_fye: "2026-09-26", financials_source: "sec_10k",
      credit_rating_previous_score: 70, credit_rating_score: 62, credit_rating_source: "keen", credit_rating_raw: "62 Adequate",
      credit_rating_updated_at: now.toISOString(),
    });
  });
  it("the same score only records the check and the year end", () => {
    expect(scoreUpdate(c(), { score: 70, as_of: "2026-09-26", from: "sec_10k" }, now)).toEqual({
      credit_rating_checked_at: now.toISOString(), financials_fye: "2026-09-26", financials_source: "sec_10k",
    });
  });
  it("taking over from another source counts as a change", () => {
    expect(scoreUpdate(c({ credit_rating_source: "dnb" }), { score: 70, from: "sec_10k" }, now).credit_rating_source).toBe("keen");
  });
});
