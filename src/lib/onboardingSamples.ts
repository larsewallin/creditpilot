/**
 * Sample applications for demos ("Load sample" on the New application form).
 * Real companies are screened and checked against the real sources; the
 * financial figures of the private and fictional companies are illustrative.
 */
/** Statements in Keen's lines (thousands of dollars): what the credit team types from the customer's accounts. */
const v = (value: number) => ({ value, status: "value" });
const lakeshoreStatements = {
  version: "KEEN-UPLOAD-2",
  answers: {
    industry: { choice: "W1" }, framework: "US GAAP", currency: "USD", units: "thousands", basis: "reviewed",
    fiscalYearStart: "2025-01-01", fiscalYearEnd: "2025-12-31", priorYearEnd: "2024-12-31", hasCashFlowStatement: true, yearsOfAccounts: 12,
    takesDeposits: false, bankruptcy: { filed: false }, goingConcern: { stated: false },
  },
  current: Object.fromEntries(Object.entries({
    "income.revenue": 48000, "income.costOfRevenue": 38400, "income.operatingIncome": 3100, "income.netIncome": 2050, "income.interestExpense": 420,
    "income.incomeTaxExpense": 630, "income.incomeBeforeTax": 2680,
    "balance.cashAndCashEquivalents": 2200, "balance.shortTermInvestments": 0, "balance.netReceivables": 7400, "balance.inventory": 6100,
    "balance.totalCurrentAssets": 16300, "balance.totalAssets": 24500, "balance.accountPayables": 4300, "balance.totalCurrentLiabilities": 8200,
    "balance.longTermDebt": 5200, "balance.totalLiabilities": 13900, "balance.totalStockholdersEquity": 10600, "balance.totalEquity": 10600,
    "balance.retainedEarnings": 8300,
    "cashFlow.operatingCashFlow": 2900, "cashFlow.capitalExpenditure": 750, "cashFlow.depreciationAndAmortization": 610, "cashFlow.netDividendsPaid": 400,
    "balance.shortTermBorrowings": 1500, "balance.currentPortionOfLongTermDebt": 600, "balance.currentFinanceLeaseLiabilities": 0,
    "balance.totalLiabilitiesAndEquity": 24500, "fixedAssets.propertyPlantEquipmentNet": 5400, "fixedAssets.depreciation": 560,
  }).map(([k, x]) => [k, v(x)])),
  prior: Object.fromEntries(Object.entries({
    "balance.cashAndCashEquivalents": 1900, "balance.netReceivables": 6900, "balance.inventory": 5800, "balance.totalCurrentAssets": 15100,
    "balance.totalAssets": 23000, "balance.totalLiabilities": 13600, "balance.totalStockholdersEquity": 9400, "balance.totalEquity": 9400,
    "fixedAssets.propertyPlantEquipmentNet": 5260, "income.revenue": 45500, "income.operatingIncome": 2800, "cashFlow.operatingCashFlow": 2500,
  }).map(([k, x]) => [k, v(x)])),
  earlierYears: [],
};

const refs = [{ company_name: "Reference One" }, { company_name: "Reference Two" }, { company_name: "Reference Three" }];
const signed = { terms: true, credit_check_consent: true };

export const SAMPLE_APPLICATIONS: { key: string; label: string; expect: string; application: Record<string, unknown> }[] = [
  {
    key: "fastenal", label: "Fastenal Company (US-listed)", expect: "Keen scores it from its latest 10-K; no statements to enter",
    application: {
      legal_name: "Fastenal Company", country_code: "US", entity_type: "corporation", website: "fastenal.com", sector: "Industrial Manufacturing",
      is_public: true, ticker: "FAST",
      billing_address: { line1: "2001 Theurer Blvd", city: "Winona", region: "MN", postal_code: "55987", country_code: "US" }, address_type: "commercial",
      people: [{ name: "Dan Florness", role: "officer" }],
      credit_request: { amount_usd: 250000, terms_days: 30, monthly_purchases_usd: 120000, invoicing_currency: "USD" },
      trade_references: refs, signatures: signed, financial_statements: [],
    },
  },
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
    key: "lakeshore", label: "Lakeshore Industrial Supply (US, fictional)", expect: "Keen scores its statements (a private company); approve as requested",
    application: {
      legal_name: "Lakeshore Industrial Supply Inc.", country_code: "US", tax_id: "31-4482910", entity_type: "corporation", sector: "Industrial Manufacturing",
      is_public: false, date_established: "2009-03-01",
      billing_address: { line1: "100 Commerce Dr", city: "Columbus", region: "OH", postal_code: "43215", country_code: "US" }, address_type: "commercial",
      people: [{ name: "Karen Whitfield", role: "officer" }, { name: "Tom Brezinski", role: "owner", ownership_pct: 60 }],
      credit_request: { amount_usd: 35000, terms_days: 30, monthly_purchases_usd: 32000, invoicing_currency: "USD" },
      trade_references: refs, signatures: signed,
      financial_statements: [], keen_statements: lakeshoreStatements,
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
