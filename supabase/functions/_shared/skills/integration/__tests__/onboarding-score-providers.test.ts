/**
 * Third-party score sources (score_providers.ts): each provider's scale onto 0–100, and the
 * pipeline taking the first source in the company's order that has a score.
 */
import { describe, it, expect } from "vitest";
import { PROVIDER } from "../../../onboarding/score_providers.ts";
import { validateSetting } from "../../../onboarding/settings_validate.ts";
import { runOnboarding } from "../../../onboarding/pipeline.ts";
import { ONBOARDING_DEFAULTS } from "../../../onboarding/settings.ts";
import type { CreditApplication, OnboardingProviders } from "../../../onboarding/types.ts";

describe("provider scales", () => {
  it("puts each provider's scale on 0–100, higher safer", () => {
    expect(PROVIDER.dnb.normalize(72)).toBe(72);
    expect(PROVIDER.creditsafe.normalize("65")).toBe(65);
    expect(["A", "b", "C", "D", "E"].map((x) => PROVIDER.creditsafe.normalize(x))).toEqual([85, 60, 40, 15, null]);
    expect(PROVIDER.coface.normalize(7)).toBe(70);
    expect(PROVIDER.coface.normalize("7,5")).toBe(75);
    expect([1, 5, 10].map((g) => PROVIDER.allianz_trade.normalize(g))).toEqual([100, 56, 0]);
    expect(PROVIDER.experian.normalize(40)).toBe(40);
    expect(PROVIDER.experian.normalize(575)).toBe(50);
  });
  it("refuses values off the provider's scale", () => {
    expect(PROVIDER.allianz_trade.normalize(0)).toBeNull();
    expect(PROVIDER.coface.normalize(11)).toBeNull();
    expect(PROVIDER.dnb.normalize("n/a")).toBeNull();
    expect(PROVIDER.experian.normalize(200)).toBeNull();
  });
});

describe("settings", () => {
  it("accepts any order of known sources, once each", () => {
    expect(validateSetting("onboarding.sources", { score_order: ["allianz_trade", "keen"] })).toEqual([]);
    expect(validateSetting("onboarding.sources", { score_order: ["keen", "keen"] })[0]).toMatch(/twice/);
    expect(validateSetting("onboarding.sources", { score_order: ["moodys"] })[0]).toMatch(/unknown score source/);
  });
});

describe("pipeline", () => {
  const app: CreditApplication = {
    application_id: "A1", submitted_by: "credit_team", legal_name: "Nordwind Logistik GmbH", country_code: "DE", date_established: "2001-01-01",
    people: [], credit_request: { amount_usd: 50_000, monthly_purchases_usd: 20_000, terms_days: 30 },
    trade_references: [{ company_name: "R1" }, { company_name: "R2" }, { company_name: "R3" }],
    financial_statements: [{ period_end: "2025-12-31", statement_quality: "audited", currency: "USD", current_assets: 5e6, current_liabilities: 2e6, total_assets: 9e6, total_liabilities: 4e6, equity: 5e6 }],
    provider_scores: [{ provider: "allianz_trade", raw: 3, as_of: "2026-10-01", max_credit_usd: 40_000 }],
    signatures: { terms: true, credit_check_consent: true },
  };
  const providers = (keen: number | null): OnboardingProviders => ({
    async findExistingCustomer() { return null; },
    async lookupRegistry() { return { source: "gleif", found: true, status: "active" }; },
    async checkTaxId() { return null; },
    async domainAgeMonths() { return null; },
    async sanctionsList() { return []; },
    async publicFinancials() { return { error: "not_found" }; },
    async keenScore() { return keen === null ? { error: "insufficient_data" } : { provider: "keen", score: keen }; },
    async macroContext() { return []; },
  });
  const settings = (order: string[]) => ({ ...ONBOARDING_DEFAULTS, sources: { score_order: order } });

  it("Keen first by default; the provider is the fallback", async () => {
    const o = await runOnboarding(app, providers(null), { asOf: "2026-11-13" });
    expect(o.analysis?.score_source).toBe("allianz_trade");
    expect(o.analysis?.score).toBe(78);
    expect(o.analysis?.score_raw).toBe("Allianz Trade 3");
    expect(o.proposal?.reason_codes).toContain("SCORE_FALLBACK");
    // providers nobody entered are not listed as gaps
    expect(o.analysis?.fallbacks.map((f) => f.provider)).toEqual(["keen"]);
  });
  it("a company that uses Allianz Trade puts it first; its credit recommendation caps the limit", async () => {
    const o = await runOnboarding(app, providers(90), { asOf: "2026-11-13", settings: settings(["allianz_trade", "keen"]) });
    expect(o.analysis?.score_source).toBe("allianz_trade");
    expect(o.proposal?.reason_codes).not.toContain("SCORE_FALLBACK");
    expect(o.proposal?.proposed_usd).toBeLessThanOrEqual(40_000);
  });
  it("Keen wins when it is first and has a score", async () => {
    const o = await runOnboarding(app, providers(90), { asOf: "2026-11-13" });
    expect(o.analysis?.score_source).toBe("keen");
  });
});
