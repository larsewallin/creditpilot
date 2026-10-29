/**
 * Sample applications for demos ("Load sample" on the New application form).
 * Real companies are screened and checked against the real sources; the
 * financial figures are illustrative, not the companies' actual accounts.
 */
const refs = [{ company_name: "Reference One" }, { company_name: "Reference Two" }, { company_name: "Reference Three" }];
const signed = { terms: true, credit_check_consent: true };

export const SAMPLE_APPLICATIONS: { key: string; label: string; expect: string; application: Record<string, unknown> }[] = [
  {
    key: "sap", label: "SAP SE (Germany)", expect: "Approve, with a macro haircut from the Germany and EUR signals",
    application: {
      legal_name: "SAP SE", country_code: "DE", tax_id: "DE143454214", entity_type: "other", website: "sap.com", sector: "Other",
      is_public: false, date_established: "1972-04-01",
      billing_address: { line1: "Dietmar-Hopp-Allee 16", city: "Walldorf", postal_code: "69190", country_code: "DE" }, address_type: "commercial",
      people: [{ name: "Christian Klein", role: "officer" }],
      credit_request: { amount_usd: 100000, terms_days: 60, monthly_purchases_usd: 50000, invoicing_currency: "EUR" },
      trade_references: refs, signatures: signed,
      financial_statements: [{ period_end: "2025-12-31", statement_quality: "audited", currency: "USD", current_assets: 20e9, current_liabilities: 15e9, total_assets: 75e9, total_liabilities: 30e9, equity: 45e9 }],
    },
  },
  {
    key: "lakeshore", label: "Lakeshore Industrial Supply (US, fictional)", expect: "Approve as requested",
    application: {
      legal_name: "Lakeshore Industrial Supply Inc.", country_code: "US", tax_id: "31-4482910", entity_type: "corporation", sector: "Industrial Manufacturing",
      is_public: false, date_established: "2009-03-01",
      billing_address: { line1: "100 Commerce Dr", city: "Columbus", region: "OH", postal_code: "43215", country_code: "US" }, address_type: "commercial",
      people: [{ name: "Karen Whitfield", role: "officer" }, { name: "Tom Brezinski", role: "owner", ownership_pct: 60 }],
      credit_request: { amount_usd: 35000, terms_days: 30, monthly_purchases_usd: 32000, invoicing_currency: "USD" },
      trade_references: refs, signatures: signed,
      financial_statements: [{ period_end: "2025-12-31", statement_quality: "reviewed", currency: "USD", revenue: 2400000, current_assets: 760000, current_liabilities: 380000, total_assets: 1200000, total_liabilities: 600000, equity: 600000 }],
    },
  },
  {
    key: "incomplete", label: "Ostrava Components USA (incomplete, fictional)", expect: "Stops at Completeness: statements and a trade reference missing",
    application: {
      legal_name: "Ostrava Components USA Corp.", country_code: "US", tax_id: "88-1029374", entity_type: "corporation", sector: "Industrial Manufacturing",
      is_public: false, date_established: "2009-03-01",
      people: [{ name: "Pavel Novak", role: "officer" }],
      credit_request: { amount_usd: 400000, terms_days: 60, monthly_purchases_usd: 120000, invoicing_currency: "USD" },
      trade_references: refs.slice(0, 2), signatures: signed, financial_statements: [],
    },
  },
  {
    key: "rosneft", label: "Rosneft Oil Company (sanctioned)", expect: "Stops at Screening: sanctions match",
    application: {
      legal_name: "Rosneft Oil Company", country_code: "RU", website: "rosneft.com", sector: "Energy", is_public: false,
      people: [], credit_request: { amount_usd: 100000, terms_days: 30, monthly_purchases_usd: 50000, invoicing_currency: "USD" },
      trade_references: refs, signatures: signed, financial_statements: [],
    },
  },
];
