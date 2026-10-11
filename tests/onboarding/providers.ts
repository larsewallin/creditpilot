/**
 * Fixture providers for the golden-prospect harness. They answer exactly what
 * a real adapter would (registry, sanctions list, File, EDGAR, macro context),
 * but from the case's JSON, so every run is deterministic and offline.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { CreditApplication, OnboardingProviders } from "../../supabase/functions/_shared/onboarding/types.ts";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const shared = (f: string) => JSON.parse(readFileSync(resolve(FIX, f), "utf8"));

export const SANCTIONS = shared("_sanctions_list.json").entries;
export const EXISTING = shared("_existing_customers.json").customers;
export const MACRO = shared("_macro_events.json").events;

export function fixtureProviders(sources: any): OnboardingProviders {
  return {
    async findExistingCustomer(app: CreditApplication) {
      for (const c of EXISTING) {
        if (app.duns && c.duns === app.duns) return { customer_id: c.customer_id, company_name: c.company_name, matched_on: "duns" };
        if (app.tax_id && c.tax_id === app.tax_id) return { customer_id: c.customer_id, company_name: c.company_name, matched_on: "tax_id" };
        if (app.registration_no && c.registration_no === app.registration_no) return { customer_id: c.customer_id, company_name: c.company_name, matched_on: "registration_no" };
      }
      return null;
    },
    async lookupRegistry() { return sources.registry ?? { source: "state_registry", found: false }; },
    async checkTaxId() { return sources.tax_id_check ?? null; },
    async domainAgeMonths() { return sources.domain_age_months ?? null; },
    async sanctionsList() { return SANCTIONS; },
    async publicFinancials() { return sources.public_financials ?? { error: "not_found" }; },
    async fileScore() { return sources.file_score ?? { error: "unavailable" }; },
    async macroContext(country, sector, currency) {
      const keys = [country, sector, currency].filter(Boolean);
      return MACRO.filter((e: any) => keys.includes(e.key));
    },
  };
}
