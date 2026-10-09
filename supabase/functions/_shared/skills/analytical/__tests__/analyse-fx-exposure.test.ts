import { describe, it, expect } from "vitest";
import {
  usdValueChangePct,
  changeOverDaysPct,
  realisedVolPct,
  evaluateFxExposureFlag,
  evaluateCurrencyVolatility,
  FX_POLICY_DEFAULTS,
  type CurrencyExposure,
  type RatePoint,
} from "../analyse-fx-exposure";

const exp = (o: Partial<CurrencyExposure> = {}): CurrencyExposure => ({
  currency: "EUR",
  unhedged_usd: 2_000_000,
  hedged_usd: 0,
  total_portfolio_exposure_usd: 100_000_000,
  unhedged_value_change_pct: 0,
  avg_window_days: 30,
  ...o,
});

function series(startRate: number, endRate: number, n: number): RatePoint[] {
  const out: RatePoint[] = [];
  const start = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, rate: startRate + ((endRate - startRate) * i) / (n - 1) });
  }
  return out;
}

describe("usdValueChangePct", () => {
  it("rate rising (currency weakens) is negative", () => {
    expect(usdValueChangePct(0.92, 0.9575)).toBeCloseTo(-3.92, 1);
  });
  it("rate falling (currency strengthens) is positive", () => {
    expect(usdValueChangePct(152, 147)).toBeCloseTo(3.4, 1);
  });
  it("invalid rates give 0", () => {
    expect(usdValueChangePct(0, 1)).toBe(0);
  });
});

describe("changeOverDaysPct", () => {
  it("uses the point ~N days before the latest", () => {
    const s = series(0.92, 0.9575, 31); // 30 days apart
    expect(changeOverDaysPct(s, 30)).toBeCloseTo(-3.92, 1);
  });
  it("null for fewer than 2 points", () => {
    expect(changeOverDaysPct([{ date: "2026-01-01", rate: 1 }], 30)).toBeNull();
  });
});

describe("realisedVolPct", () => {
  it("flat series has ~0 vol", () => {
    expect(realisedVolPct(series(1, 1, 40), 30)).toBeCloseTo(0, 5);
  });
  it("null with too little data", () => {
    expect(realisedVolPct(series(1, 1.1, 4), 30)).toBeNull();
  });
  it("alternating series has material vol", () => {
    const s = series(1, 1, 40).map((p, i) => ({ ...p, rate: i % 2 ? 1.02 : 1 }));
    expect(realisedVolPct(s, 30)!).toBeGreaterThan(20);
  });
});

describe("evaluateFxExposureFlag", () => {
  it("nothing unhedged -> null", () => {
    expect(evaluateFxExposureFlag(exp({ unhedged_usd: 0, hedged_usd: 5_000_000 }), -5)).toBeNull();
  });
  it("small unhedged exposure -> null", () => {
    expect(evaluateFxExposureFlag(exp({ unhedged_usd: 200_000 }), 0)).toBeNull();
  });
  it("large unhedged, no adverse move -> low (size alone fires)", () => {
    const r = evaluateFxExposureFlag(exp(), 2);
    expect(r?.severity).toBe("low");
    expect(r?.adverse).toBe(false);
  });
  it("very large unhedged -> medium base", () => {
    expect(evaluateFxExposureFlag(exp({ unhedged_usd: 6_000_000 }), 0)?.severity).toBe("medium");
  });
  it("adverse 30d move escalates one level", () => {
    expect(evaluateFxExposureFlag(exp(), -4)?.severity).toBe("medium");
  });
  it("adverse since booking escalates", () => {
    expect(evaluateFxExposureFlag(exp({ unhedged_value_change_pct: -3.5 }), 0)?.severity).toBe("medium");
  });
  it("adverse plus long window escalates two levels, capped at high", () => {
    expect(evaluateFxExposureFlag(exp({ avg_window_days: 75 }), -4)?.severity).toBe("high");
    expect(evaluateFxExposureFlag(exp({ unhedged_usd: 8_000_000, avg_window_days: 75 }), -9)?.severity).toBe("high");
  });
  it("favourable move never escalates", () => {
    expect(evaluateFxExposureFlag(exp({ avg_window_days: 90 }), 6)?.severity).toBe("low");
  });
  it("share of portfolio alone makes it large", () => {
    const r = evaluateFxExposureFlag(exp({ unhedged_usd: 500_000, total_portfolio_exposure_usd: 4_000_000 }), 0);
    expect(r).not.toBeNull();
    expect(r!.share_of_portfolio_pct).toBeCloseTo(12.5, 1);
  });
  it("respects a custom policy", () => {
    const p = { ...FX_POLICY_DEFAULTS, UNHEDGED_FLOOR_USD: 5_000_000, UNHEDGED_SHARE_PCT: 50 };
    expect(evaluateFxExposureFlag(exp(), 0, p)).toBeNull();
  });
});

describe("evaluateCurrencyVolatility", () => {
  it("small move -> null", () => {
    expect(evaluateCurrencyVolatility(-2, 5, 5_000_000)).toBeNull();
    expect(evaluateCurrencyVolatility(null, 5, 5_000_000)).toBeNull();
  });
  it("favourable move -> info", () => {
    const r = evaluateCurrencyVolatility(3.4, 6, 5_000_000);
    expect(r?.severity).toBe("info");
    expect(r?.direction).toBe("favourable");
  });
  it("adverse 4% -> medium; 7% -> high; 11% -> critical", () => {
    expect(evaluateCurrencyVolatility(-4, 5, 5_000_000)?.severity).toBe("medium");
    expect(evaluateCurrencyVolatility(-7, 5, 5_000_000)?.severity).toBe("high");
    expect(evaluateCurrencyVolatility(-11, 5, 5_000_000)?.severity).toBe("critical");
  });
  it("high realised vol bumps one level", () => {
    expect(evaluateCurrencyVolatility(-4, 15, 5_000_000)?.severity).toBe("high");
  });
  it("immaterial exposure caps at low", () => {
    expect(evaluateCurrencyVolatility(-11, 20, 100_000)?.severity).toBe("low");
  });
});
