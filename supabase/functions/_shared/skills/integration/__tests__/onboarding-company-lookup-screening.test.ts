/**
 * Screening with a Company Lookup card: a stop-level flag on the card sends the
 * application to a person (review), never to a decline; a clear card passes.
 */
import { describe, it, expect } from "vitest";
import { runOnboarding } from "../../../onboarding/pipeline.ts";
import type { CreditApplication, OnboardingProviders, RegistryRecord } from "../../../onboarding/types.ts";

const app: CreditApplication = {
  application_id: "A1", submitted_by: "credit_team", legal_name: "Harbour Freight Partners Ltd", country_code: "GB",
  company_id: "gb:09999999", date_established: "2010-01-01",
  people: [], credit_request: { amount_usd: 50_000 },
  trade_references: [{ company_name: "R1" }, { company_name: "R2" }, { company_name: "R3" }],
  financial_statements: [], signatures: { terms: true, credit_check_consent: true },
};

const providers = (registry: RegistryRecord): OnboardingProviders => ({
  async findExistingCustomer() { return null; },
  async lookupRegistry() { return registry; },
  async checkTaxId() { return null; },
  async domainAgeMonths() { return null; },
  async sanctionsList() { return []; },
  async publicFinancials() { return { error: "not_found" }; },
  async keenScore() { return { error: "unavailable" }; },
  async macroContext() { return []; },
});

const card = (level?: string): RegistryRecord => ({
  source: "company_lookup", found: true, status: "active", legal_name: app.legal_name, formation_date: "2010-01-01",
  lookup: { company_id: app.company_id!, verdict: level === "stop" ? "stop" : "clear", as_of: "2026-11-13",
    flags: level ? [{ level, label: "Registered office is a known mass-registration address" }] : [], sources: [] },
});

describe("screening with a Company Lookup card", () => {
  it("passes on a clear card and keeps the card on the outcome", async () => {
    const o = await runOnboarding(app, providers(card()), { asOf: "2026-11-13" });
    expect(o.screening?.status).toBe("pass");
    expect(o.screening?.checks).toContain("registry:company_lookup");
    expect(o.screening?.lookup?.company_id).toBe("gb:09999999");
  });
  it("sends a stop-level flag to review, never a decline", async () => {
    const o = await runOnboarding(app, providers(card("stop")), { asOf: "2026-11-13" });
    expect(o.screening?.status).toBe("review");
    expect(o.screening?.fraud_flags).toContain("COMPANY_LOOKUP_STOP");
    expect(o.proposal).toBeUndefined();
  });
  it("lets a person accept the flag", async () => {
    const o = await runOnboarding(app, providers(card("stop")), { asOf: "2026-11-13", cleared: { fraud_flags_accepted: true } });
    expect(o.screening?.status).toBe("pass");
  });
  it("does not count check-level flags as fraud flags", async () => {
    const o = await runOnboarding(app, providers(card("check")), { asOf: "2026-11-13" });
    expect(o.screening?.fraud_flags).toEqual([]);
    expect(o.screening?.status).toBe("pass");
  });
});
