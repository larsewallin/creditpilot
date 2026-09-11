import { describe, it, expect } from "vitest";
import { detectRatingChange } from "../detect-rating-change";

describe("detectRatingChange", () => {
  // ── No significant change ──────────────────────────────────────────────────

  it("delta < 5 → type null, no action", () => {
    const result = detectRatingChange(70, 67);
    expect(result.type).toBeNull();
    expect(result.severity).toBeNull();
    expect(result.action_required).toBe(false);
    expect(result.delta).toBe(-3);
  });

  it("delta = 0 → type null", () => {
    const result = detectRatingChange(50, 50);
    expect(result.type).toBeNull();
  });

  it("delta exactly 4 (just below threshold) → type null", () => {
    const result = detectRatingChange(80, 76);
    expect(result.type).toBeNull();
  });

  // ── Downgrades ────────────────────────────────────────────────────────────

  it("delta -8 → low downgrade, action_required false", () => {
    const result = detectRatingChange(70, 62);
    expect(result.type).toBe("CREDIT_RATING_DOWNGRADE");
    expect(result.severity).toBe("low");
    expect(result.action_required).toBe(false);
    expect(result.delta).toBe(-8);
  });

  it("delta -5 (exactly at threshold) → low downgrade", () => {
    const result = detectRatingChange(60, 55);
    expect(result.type).toBe("CREDIT_RATING_DOWNGRADE");
    expect(result.severity).toBe("low");
  });

  it("delta -12 → medium downgrade, action_required true", () => {
    const result = detectRatingChange(80, 68);
    expect(result.type).toBe("CREDIT_RATING_DOWNGRADE");
    expect(result.severity).toBe("medium");
    expect(result.action_required).toBe(true);
    expect(result.delta).toBe(-12);
  });

  it("delta -10 (exactly medium threshold) → medium, action_required true", () => {
    const result = detectRatingChange(70, 60);
    expect(result.type).toBe("CREDIT_RATING_DOWNGRADE");
    expect(result.severity).toBe("medium");
    expect(result.action_required).toBe(true);
  });

  it("delta -22 → high downgrade, action_required true", () => {
    const result = detectRatingChange(80, 58);
    expect(result.type).toBe("CREDIT_RATING_DOWNGRADE");
    expect(result.severity).toBe("high");
    expect(result.action_required).toBe(true);
    expect(result.delta).toBe(-22);
  });

  it("delta -32 → critical downgrade, action_required true", () => {
    const result = detectRatingChange(90, 58);
    expect(result.type).toBe("CREDIT_RATING_DOWNGRADE");
    expect(result.severity).toBe("critical");
    expect(result.action_required).toBe(true);
    expect(result.delta).toBe(-32);
  });

  it("delta -30 (exactly critical threshold) → critical", () => {
    const result = detectRatingChange(80, 50);
    expect(result.type).toBe("CREDIT_RATING_DOWNGRADE");
    expect(result.severity).toBe("critical");
  });

  // ── Upgrades ──────────────────────────────────────────────────────────────

  it("positive delta above threshold → upgrade, severity info, no action", () => {
    const result = detectRatingChange(50, 70);
    expect(result.type).toBe("CREDIT_RATING_UPGRADE");
    expect(result.severity).toBe("info");
    expect(result.action_required).toBe(false);
    expect(result.delta).toBe(20);
  });

  it("small positive delta (< 5) → no significant change, not an upgrade", () => {
    const result = detectRatingChange(50, 53);
    expect(result.type).toBeNull();
  });

  it("large upgrade → still info, never triggers action", () => {
    const result = detectRatingChange(10, 90);
    expect(result.type).toBe("CREDIT_RATING_UPGRADE");
    expect(result.severity).toBe("info");
    expect(result.action_required).toBe(false);
  });

  // ── Score passthrough ─────────────────────────────────────────────────────

  it("always returns previous_score and current_score", () => {
    const result = detectRatingChange(75, 50);
    expect(result.previous_score).toBe(75);
    expect(result.current_score).toBe(50);
  });
});
