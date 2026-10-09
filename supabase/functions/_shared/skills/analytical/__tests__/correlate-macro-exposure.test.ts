import { describe, it, expect } from "vitest";
import { correlateCustomer, buildClusters, isAdverse, type MacroEvent, type MacroCustomer } from "../correlate-macro-exposure";

const cust = (o: Partial<MacroCustomer> = {}): MacroCustomer => ({
  id: "c1", company_name: "Ruhr Bergbau AG", country_code: "DE", sector: "Mining", current_exposure: 500_000, ...o,
});
const ev = (id: string, event_type: string, severity: any, payload: any): MacroEvent => ({ id, event_type, severity, payload });

const deRating = ev("e1", "COUNTRY_RATING_CHANGE", "high", { country_code: "DE" });
const eurVol = ev("e2", "CURRENCY_VOLATILITY", "high", { currency_code: "EUR", direction: "adverse" });
const miningDown = ev("e3", "INDUSTRY_DOWNTURN", "high", { sector: "Mining" });

describe("isAdverse", () => {
  it("medium severity does not count as convergence evidence", () => {
    expect(isAdverse(ev("x", "COUNTRY_RATING_CHANGE", "medium", {}))).toBe(false);
  });
  it("ignores low/info severity", () => {
    expect(isAdverse(ev("x", "COUNTRY_RATING_CHANGE", "low", {}))).toBe(false);
    expect(isAdverse(ev("x", "COUNTRY_RATING_CHANGE", "info", {}))).toBe(false);
  });
  it("ignores favourable currency moves", () => {
    expect(isAdverse(ev("x", "CURRENCY_VOLATILITY", "medium", { direction: "favourable" }))).toBe(false);
  });
  it("FX flag counts only with an adverse move", () => {
    expect(isAdverse(ev("x", "FX_EXPOSURE_FLAG", "high", { adverse_move_pct: 3.4 }))).toBe(false);
    expect(isAdverse(ev("x", "FX_EXPOSURE_FLAG", "high", { adverse_move_pct: -3.8 }))).toBe(true);
  });
  it("ignores unrelated event types", () => {
    expect(isAdverse(ev("x", "NEWS_EVENT", "critical", {}))).toBe(false);
  });
});

describe("correlateCustomer", () => {
  it("single dimension returns null", () => {
    expect(correlateCustomer(cust(), [deRating], {})).toBeNull();
  });
  it("two dimensions -> medium", () => {
    const r = correlateCustomer(cust({ sector: "Energy" }), [deRating, eurVol], { EUR: 400_000 });
    expect(r?.dimensions.sort()).toEqual(["country", "currency"]);
    expect(r?.severity).toBe("medium");
  });
  it("three dimensions -> high with score above top component", () => {
    const r = correlateCustomer(cust(), [deRating, eurVol, miningDown], { EUR: 400_000 });
    expect(r?.severity).toBe("high");
    expect(r?.risk_score).toBe(95);
  });
  it("currency ignored when fully hedged", () => {
    expect(correlateCustomer(cust({ sector: "Energy" }), [deRating, eurVol], { EUR: 0 })).toBeNull();
  });
  it("events for other countries/sectors do not apply", () => {
    const r = correlateCustomer(cust({ country_code: "JP", sector: "Energy" }), [deRating, miningDown, eurVol], { JPY: 100 });
    expect(r).toBeNull();
  });
  it("a critical component bumps severity one level", () => {
    const crit = ev("e9", "COUNTRY_ECONOMIC_SHOCK", "critical", { country_code: "DE" });
    expect(correlateCustomer(cust({ sector: "Energy" }), [crit, eurVol], { EUR: 1 })?.severity).toBe("high");
  });
  it("tariff applies to affected countries", () => {
    const tariff = ev("t", "TARIFF_CHANGE", "high", { origin_country: "US", affected_countries: ["CN", "MX"] });
    const r = correlateCustomer(cust({ country_code: "MX", sector: "Mining" }), [tariff, miningDown], {});
    expect(r?.dimensions.sort()).toEqual(["country", "industry"]);
  });
  it("tariff does not apply to the country imposing it", () => {
    const tariff = ev("t", "TARIFF_CHANGE", "high", { origin_country: "US", affected_countries: ["CN", "MX"] });
    expect(correlateCustomer(cust({ country_code: "US", sector: "Mining" }), [tariff, miningDown], {})).toBeNull();
  });
});

describe("buildClusters", () => {
  it("groups converging customers by country", () => {
    const c1 = cust({ id: "a", current_exposure: 300_000 });
    const c2 = cust({ id: "b", current_exposure: 200_000, sector: "Energy" });
    const r1 = correlateCustomer(c1, [deRating, eurVol, miningDown], { EUR: 1 })!;
    const r2 = correlateCustomer(c2, [deRating, eurVol], { EUR: 1 })!;
    const cl = buildClusters([r1, r2], [c1, c2]);
    expect(cl).toHaveLength(1);
    expect(cl[0].exposure_usd).toBe(500_000);
    expect(cl[0].confidence).toBe("high");
    expect(cl[0].sectors.sort()).toEqual(["Energy", "Mining"]);
  });
});
