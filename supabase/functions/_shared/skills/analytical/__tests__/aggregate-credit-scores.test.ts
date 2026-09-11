import { describe, it, expect } from "vitest";
import { aggregateCreditScores } from "../aggregate-credit-scores";
import { CreditSignal } from "../normalise-credit-signal";

function sig(
  source: CreditSignal["source"],
  raw_value: number | string,
  confidence: CreditSignal["confidence"] = "high"
): CreditSignal {
  return { source, raw_value, as_of_date: "2026-01-01", confidence };
}

describe("aggregateCreditScores", () => {
  // ── Empty / null input ────────────────────────────────────────────────────

  it("empty array → final_score null, interpretation NR, source_count 0", () => {
    const result = aggregateCreditScores([]);
    expect(result.final_score).toBeNull();
    expect(result.interpretation).toBe("NR");
    expect(result.source_count).toBe(0);
    expect(result.source_providers).toHaveLength(0);
    expect(result.sources).toHaveLength(0);
  });

  it("null input → final_score null, interpretation NR", () => {
    const result = aggregateCreditScores(null as any);
    expect(result.final_score).toBeNull();
    expect(result.interpretation).toBe("NR");
  });

  // ── Single source ─────────────────────────────────────────────────────────

  it("single source → score equals normalised score directly", () => {
    const result = aggregateCreditScores([sig("dnb_paydex", 80)]);
    expect(result.final_score).toBe(80);
    expect(result.source_count).toBe(1);
    expect(result.source_providers).toEqual(["dnb_paydex"]);
  });

  it("single high-authority source (S&P AAA) → score 100", () => {
    const result = aggregateCreditScores([sig("sp_fitch", "AAA")]);
    expect(result.final_score).toBe(100);
    expect(result.source_providers).toEqual(["sp_fitch"]);
  });

  // ── Two sources ───────────────────────────────────────────────────────────

  it("two sources → simple average (no weights applied)", () => {
    // moodys "Aaa" = 100, dnb_paydex 60 = 60
    // simple avg = (100 + 60) / 2 = 80
    const result = aggregateCreditScores([
      sig("moodys", "Aaa"),
      sig("dnb_paydex", 60),
    ]);
    expect(result.source_count).toBe(2);
    expect(result.final_score).toBeCloseTo(80, 1);
    expect(result.source_providers).toEqual(["moodys", "dnb_paydex"]);
  });

  // ── Three sources ─────────────────────────────────────────────────────────

  it("three sources → simple average, source_providers lists all three", () => {
    const result = aggregateCreditScores([
      sig("moodys", "Baa2"),   // 70
      sig("dnb_paydex", 80),   // 80
      sig("coface", 6),        // 60
    ]);
    expect(result.source_count).toBe(3);
    // simple avg = (70 + 80 + 60) / 3 ≈ 70
    expect(result.final_score).toBeCloseTo(70, 1);
    expect(result.source_providers).toEqual(["moodys", "dnb_paydex", "coface"]);
  });

  it("four sources → source_count 4, all providers listed", () => {
    const result = aggregateCreditScores([
      sig("moodys", "Aaa"),
      sig("sp_fitch", "AAA"),
      sig("dnb_paydex", 90),
      sig("coface", 9),
    ]);
    expect(result.source_count).toBe(4);
    expect(result.source_providers).toHaveLength(4);
  });

  // ── Unknown provider ──────────────────────────────────────────────────────

  it("any provider → score is its normalised score (no weight advantage)", () => {
    const result = aggregateCreditScores([sig("manual", 70)]);
    expect(result.final_score).toBe(70);
    expect(result.source_providers).toEqual(["manual"]);
  });

  // ── Interpretation bands ──────────────────────────────────────────────────

  it("score ≥ 80 → very_safe", () => {
    const result = aggregateCreditScores([sig("dnb_paydex", 85)]);
    expect(result.interpretation).toBe("very_safe");
  });

  it("score 60–79 → safe", () => {
    const result = aggregateCreditScores([sig("dnb_paydex", 65)]);
    expect(result.interpretation).toBe("safe");
  });

  it("score 40–59 → watch", () => {
    const result = aggregateCreditScores([sig("dnb_paydex", 50)]);
    expect(result.interpretation).toBe("watch");
  });

  it("score 20–39 → concern", () => {
    const result = aggregateCreditScores([sig("dnb_paydex", 25)]);
    expect(result.interpretation).toBe("concern");
  });

  it("score < 20 → high_risk", () => {
    const result = aggregateCreditScores([sig("dnb_paydex", 10)]);
    expect(result.interpretation).toBe("high_risk");
  });

  // ── Source breakdown ──────────────────────────────────────────────────────

  it("sources array contains provider, raw_score, normalised_score (no weight field)", () => {
    const result = aggregateCreditScores([sig("sp_fitch", "BBB+")]);
    const src = result.sources[0];
    expect(src.provider).toBe("sp_fitch");
    expect(src.raw_score).toBe("BBB+");
    expect(src.normalised_score).toBe(75);
    expect((src as any).weight).toBeUndefined();
  });

  // ── Equal weighting between providers ────────────────────────────────────

  it("all providers contribute equally — final score is midpoint of two signals", () => {
    // moodys "B1" ≈ 33, estimated 90 → simple avg ≈ 61.5
    const result = aggregateCreditScores([
      sig("moodys", "B1"),   // ~33
      sig("estimated", 90),  // 90
    ]);
    // With equal weights, result should be approximately midpoint (not pulled toward moodys)
    expect(result.final_score).toBeGreaterThan(50);
    expect(result.final_score).toBeLessThan(80);
  });
});
