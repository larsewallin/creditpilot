import { describe, it, expect } from "vitest";
import {
  normalizeChangePercent,
  getIndicatorsForSector,
  SECTOR_INDICATOR_CONFIG,
} from "../sector-exposure-direction";

describe("normalizeChangePercent", () => {
  // ── The trickiest piece: same raw indicator, opposite normalized sign ──────

  it("same commodity_price move, opposite normalized sign for producer vs consumer", () => {
    // Oil price +10% (raw): good for Energy (producer), bad for Transportation (consumer)
    const rawChange = 10;
    expect(normalizeChangePercent(rawChange, "producer")).toBe(10);
    expect(normalizeChangePercent(rawChange, "consumer")).toBe(-10);
  });

  it("same commodity_price move in the other direction, still opposite signs", () => {
    // Oil price -15% (raw): bad for Energy (producer), good for Transportation (consumer)
    const rawChange = -15;
    expect(normalizeChangePercent(rawChange, "producer")).toBe(-15);
    expect(normalizeChangePercent(rawChange, "consumer")).toBe(15);
  });

  // ── Producer: no flip ────────────────────────────────────────────────────

  it("producer role never flips sign", () => {
    expect(normalizeChangePercent(7.5, "producer")).toBe(7.5);
    expect(normalizeChangePercent(-7.5, "producer")).toBe(-7.5);
    expect(normalizeChangePercent(0, "producer")).toBe(0);
  });

  // ── Consumer: always flips ───────────────────────────────────────────────

  it("consumer role always flips sign", () => {
    expect(normalizeChangePercent(7.5, "consumer")).toBe(-7.5);
    expect(normalizeChangePercent(-7.5, "consumer")).toBe(7.5);
    expect(normalizeChangePercent(0, "consumer")).toBe(-0); // -0 === 0 numerically, still correct
  });

  // ── Self: never flips (own vital sign, not a traded input) ──────────────

  it("self role never flips sign, same as producer", () => {
    expect(normalizeChangePercent(-12, "self")).toBe(-12);
    expect(normalizeChangePercent(12, "self")).toBe(12);
  });
});

describe("getIndicatorsForSector", () => {
  it("returns all configured indicators for a sector with multiple entries", () => {
    const energy = getIndicatorsForSector("Energy");
    expect(energy.length).toBeGreaterThanOrEqual(3);
    expect(energy.map((e) => e.indicator)).toContain("commodity_price");
    expect(energy.map((e) => e.indicator)).toContain("production_output");
  });

  it("Energy's commodity_price role is producer, Transportation's is consumer", () => {
    const energyOil = getIndicatorsForSector("Energy").find((e) => e.indicator === "commodity_price");
    const transportOil = getIndicatorsForSector("Transportation").find((e) => e.indicator === "commodity_price");
    expect(energyOil?.role).toBe("producer");
    expect(transportOil?.role).toBe("consumer");
  });

  it("'Other' has no configured indicators", () => {
    expect(getIndicatorsForSector("Other")).toEqual([]);
  });

  it("unknown sector returns empty, not an error", () => {
    expect(getIndicatorsForSector("Not A Real Sector")).toEqual([]);
  });

  it("every config entry has a non-empty source_series", () => {
    for (const entry of SECTOR_INDICATOR_CONFIG) {
      expect(entry.source_series.length).toBeGreaterThan(0);
      expect(entry.source_series).toMatch(/^(FRED|BLS):/);
    }
  });
});
