import { describe, expect, it } from "vitest";
import { quietAfterRejection } from "../quiet.ts";
import { POLICY_DEFAULTS } from "../defaults.ts";

const rules = POLICY_DEFAULTS.limit_review;
const now = new Date("2026-11-21T12:00:00Z");
const rejected = (daysAgo: number, cutTo: number) => ({ current_value: 1_000_000, proposed_value: cutTo, reviewed_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() });

describe("quiet after a rejected cut (founder, 2026-11-21: 30 days)", () => {
  it("stays quiet about the same cut within 30 days", () => {
    expect(quietAfterRejection([rejected(10, 800_000)], { current_value: 1_000_000, proposed_value: 800_000 }, rules, now)).toMatch(/quiet for 30 days/);
  });
  it("proposes again after 30 days", () => {
    expect(quietAfterRejection([rejected(31, 800_000)], { current_value: 1_000_000, proposed_value: 800_000 }, rules, now)).toBeNull();
  });
  it("proposes again within 30 days when it got worse: a cut 10 points deeper", () => {
    expect(quietAfterRejection([rejected(5, 800_000)], { current_value: 1_000_000, proposed_value: 700_000 }, rules, now)).toBeNull();
    expect(quietAfterRejection([rejected(5, 800_000)], { current_value: 1_000_000, proposed_value: 750_000 }, rules, now)).not.toBeNull();
  });
  it("is quiet for nothing when nothing was rejected", () => {
    expect(quietAfterRejection([], { current_value: 1_000_000, proposed_value: 500_000 }, rules, now)).toBeNull();
  });
});
