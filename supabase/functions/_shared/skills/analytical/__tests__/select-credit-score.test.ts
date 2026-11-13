import { describe, it, expect } from "vitest";
import { selectCreditScore } from "../select-credit-score";

const ok = (score: number) => async () => ({ score });
const err = (error: string) => async () => ({ error });

describe("selectCreditScore", () => {
  it("uses the first source that has a score, never an average", async () => {
    const r = await selectCreditScore(["keen", "dnb"], { keen: ok(82), dnb: ok(40) });
    expect(r.source).toBe("keen");
    expect(r.result?.score).toBe(82);
    expect(r.used_fallback).toBe(false);
    expect(r.fallbacks).toEqual([]);
  });

  it("falls back to the next source and records why", async () => {
    const r = await selectCreditScore(["keen", "bureau_report"], { keen: err("insufficient_data"), bureau_report: ok(71) });
    expect(r.source).toBe("bureau_report");
    expect(r.used_fallback).toBe(true);
    expect(r.fallbacks).toEqual([{ provider: "keen", reason: "insufficient_data" }]);
  });

  it("does not call lower-priority sources once a score is found", async () => {
    let called = false;
    await selectCreditScore(["keen", "dnb"], { keen: ok(90), dnb: async () => { called = true; return { score: 1 }; } });
    expect(called).toBe(false);
  });

  it("records unsupported sources, thrown errors and bad scores", async () => {
    const r = await selectCreditScore(["creditsafe", "keen", "dnb"], {
      keen: async () => { throw new Error("boom"); },
      dnb: async () => ({ score: Number.NaN }),
    });
    expect(r.source).toBeUndefined();
    expect(r.fallbacks).toEqual([
      { provider: "creditsafe", reason: "not_supported" },
      { provider: "keen", reason: "unavailable" },
      { provider: "dnb", reason: "invalid_score" },
    ]);
  });

  it("clamps to 0–100", async () => {
    expect((await selectCreditScore(["keen"], { keen: ok(130) })).result?.score).toBe(100);
  });
});
