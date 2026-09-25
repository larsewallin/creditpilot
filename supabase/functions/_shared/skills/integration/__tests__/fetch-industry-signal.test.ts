import { describe, it, expect } from "vitest";
import { classifyDisruptionType } from "../fetch-industry-signal";

describe("classifyDisruptionType", () => {
  it("classifies geopolitical signals", () => {
    expect(classifyDisruptionType("New sanctions target steel exports")).toBe("geopolitical");
    expect(classifyDisruptionType("Tariffs raised on imported machinery")).toBe("geopolitical");
  });

  it("classifies labor signals without false-positiving on unrelated 'union'/'war' substrings", () => {
    expect(classifyDisruptionType("Dockworkers strike halts port operations")).toBe("labor");
    expect(classifyDisruptionType("European Union proposes new trade rules")).not.toBe("labor");
    expect(classifyDisruptionType("Extended warranty program announced")).not.toBe("geopolitical");
  });

  it("classifies natural_disaster, supply_chain, regulatory, technology, demand_shock", () => {
    expect(classifyDisruptionType("Flooding shuts down mining operations")).toBe("natural_disaster");
    expect(classifyDisruptionType("Chip shortage delays factory output")).toBe("supply_chain");
    expect(classifyDisruptionType("Regulator proposes new drilling permit rules")).toBe("regulatory");
    expect(classifyDisruptionType("Cyberattack causes plant outage")).toBe("technology");
    expect(classifyDisruptionType("Recession fears trigger demand slowdown")).toBe("demand_shock");
  });

  it("falls back to 'other' when nothing matches", () => {
    expect(classifyDisruptionType("Company announces quarterly earnings")).toBe("other");
  });
});
