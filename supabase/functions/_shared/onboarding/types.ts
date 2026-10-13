/**
 * New Customer Onboarding — shared contract.
 *
 * Design: claude/CreditPilot_Onboarding_Build_Plan.md (Project files).
 *
 * The pipeline core (pipeline.ts) is pure orchestration: every external
 * source (registries, sanctions lists, File, EDGAR, bureau reports, macro
 * context, existing customers) is reached through the `OnboardingProviders`
 * interface below. Production wires real adapters; the golden-prospect
 * harness (tests/onboarding) wires fixture providers. This is what lets the
 * whole decision path be tested without a live client.
 */

// ─── Application (what the applicant / credit team submits) ──────────────────

export type EntityType =
  | "corporation" | "llc" | "partnership" | "sole_proprietor"
  | "ltd" | "plc" | "gmbh" | "ag" | "sa" | "bv" | "other";

export interface Person {
  name: string;
  role: "officer" | "director" | "owner" | "guarantor";
  ownership_pct?: number;
  date_of_birth?: string; // never stored after screening
  country_code?: string;
}

export interface Address {
  line1: string;
  city: string;
  region?: string;
  postal_code: string;
  country_code: string;
}

export interface TradeReference {
  company_name: string;
  contact_email?: string;
}

export interface FinancialStatement {
  period_end: string;
  statement_quality: "audited" | "reviewed" | "compiled" | "tax_return" | "management";
  currency: string;
  revenue?: number;
  ebitda?: number;
  net_income?: number;
  total_assets?: number;
  total_liabilities?: number;
  current_assets?: number;
  current_liabilities?: number;
  equity?: number;
  cash?: number;
}

export interface CreditApplication {
  application_id: string;
  submitted_by: "credit_team" | "sales_rep" | "buyer";
  legal_name: string;
  trade_name?: string;
  entity_type?: EntityType;
  country_code?: string;
  registration_no?: string;
  tax_id?: string;          // EIN (US), VAT (EU/UK)
  duns?: string;
  website?: string;
  sector?: string;          // industry, matched against Industry agent sectors
  is_public?: boolean;
  ticker?: string;
  cik?: string;
  date_established?: string; // as stated by applicant
  billing_address?: Address;
  address_type?: "commercial" | "residential" | "virtual" | "po_box";
  ap_contact_email?: string;
  people: Person[];
  credit_request: {
    amount_usd?: number;
    terms_days?: number;
    monthly_purchases_usd?: number;
    invoicing_currency?: string;
  };
  trade_references: TradeReference[];
  bank_reference?: { bank_name: string };
  financial_statements: FinancialStatement[];
  bureau_report?: BureauReport;   // uploaded PDF, already parsed
  signatures: {
    terms?: boolean;
    credit_check_consent?: boolean;
    personal_guarantee?: boolean;
  };
}

// ─── Provider results ─────────────────────────────────────────────────────────

export interface RegistryRecord {
  source: "companies_house" | "sec_edgar" | "gleif" | "state_registry" | "national_registry";
  found: boolean;
  status?: "active" | "dissolved" | "dormant";
  legal_name?: string;
  formation_date?: string;
  officers?: Person[];
  owners?: Person[];   // e.g. UK PSC register
}

export interface TaxIdCheck {
  source: "vies" | "hmrc_vat" | "ein_format";
  valid: boolean;
}

export interface SanctionsEntry {
  list: "OFAC_SDN" | "EU" | "UK" | "UN";
  name: string;
  type: "entity" | "person";
  country_code?: string;
}

export interface ScoreResult {
  provider: "file" | "bureau_report" | string;
  score: number;            // normalized 0–100, higher = safer
  model_version?: string;
  reason_codes?: string[];
  max_credit_recommendation_usd?: number;
}

export interface BureauReport {
  bureau: string;           // "Experian", "D&B", "Creditsafe", …
  score_normalized: number; // 0–100, higher = safer
  max_credit_recommendation_usd?: number;
  avg_days_beyond_terms?: number;
  liens_or_judgments?: number;
}

export type ProviderError = { error: "timeout" | "insufficient_data" | "unavailable" | "not_found" };

export interface MacroContextEvent {
  source_agent: "country_risk_agent" | "industry_risk_agent" | "fx_risk_agent" | "news_agent";
  event_type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  key: string;  // country code, sector, or currency code
  title: string;
}

export interface ExistingCustomerMatch {
  customer_id: string;
  company_name: string;
  matched_on: "duns" | "tax_id" | "registration_no" | "lei" | "name";
}

/** Everything the pipeline may ask the outside world. All async. */
export interface OnboardingProviders {
  findExistingCustomer(app: CreditApplication): Promise<ExistingCustomerMatch | null>;
  lookupRegistry(app: CreditApplication): Promise<RegistryRecord>;
  checkTaxId(app: CreditApplication): Promise<TaxIdCheck | null>;
  domainAgeMonths(website: string): Promise<number | null>;
  sanctionsList(): Promise<SanctionsEntry[]>;
  publicFinancials(app: CreditApplication): Promise<FinancialStatement[] | ProviderError>;
  fileScore(app: CreditApplication): Promise<ScoreResult | ProviderError>;
  macroContext(country_code: string | undefined, sector: string | undefined, currency: string | undefined): Promise<MacroContextEvent[]>;
}

// ─── Settings (company_settings › onboarding.*; defaults in settings.ts) ──────

export interface OnboardingSettings {
  template: {
    min_trade_references: number;
    statements_required_above_usd: number;      // private companies only
    guarantee_required_if_entity_younger_than_months: number;
  };
  screening: {
    name_match_review_threshold: number;        // 0–1
    name_match_hit_threshold: number;           // 0–1, plus country agreement
    fraud_flags_for_review: number;             // combination rule
    young_entity_months: number;
    young_entity_large_request_usd: number;
    new_domain_months: number;
  };
  limits: {
    needs_buffer_pct: number;
    working_capital_pct: number;
    net_worth_pct: number;
    compiled_statement_haircut_pct: number;
    macro_haircut_pct: number;                  // once, if country or currency has high+ event
    band_multipliers: { A: number; B: number; C: number; D: number; E: number };
    higher_limit_note_ratio: number;            // supportable ≥ ratio × requested
    rounding_usd: number;                       // round down to this step
  };
  sources: {
    score_order: string[];                      // e.g. ["file", "bureau_report"]
  };
}

// ─── Pipeline outcome (what the harness asserts on) ───────────────────────────

export type Stage = "application" | "completeness" | "screening" | "analysis" | "decision" | "approval" | "conditions" | "active";

export type FraudFlag =
  | "YOUNG_ENTITY_LARGE_REQUEST" | "NEW_DOMAIN" | "ADDRESS_RISK" | "FORMATION_DATE_MISMATCH" | "REGISTRY_NOT_FOUND"
  | "REGISTRY_INACTIVE"   // dissolved or dormant: always review on its own
  | "TAX_ID_INVALID";

export interface ScreeningHit {
  subject: string;           // name screened
  subject_type: "entity" | "person";
  list_entry: string;
  list: string;
  similarity: number;
  status: "open" | "confirmed";  // a person disposes; agent never clears
}

export interface OnboardingOutcome {
  application_id: string;
  stopped_at: Stage;           // last stage reached (decision = proposal ready for approval)
  route?: "new_customer" | "existing_customer_limit_review";
  duplicate_of?: string;
  events: string[];            // event types to emit via publishEvent, in order
  completeness?: {
    status: "complete" | "incomplete";
    missing: string[];
    reg_b_clock_days?: number;
  };
  screening?: {
    status: "pass" | "review" | "fail";
    checks: string[];          // check names run, e.g. "companies_house", "hmrc_vat", "sanctions_entity"
    people_screened: number;
    hits: ScreeningHit[];
    fraud_flags: FraudFlag[];
  };
  analysis?: {
    financials_source?: "uploaded_statements" | "sec_edgar" | "none";
    statement_quality?: FinancialStatement["statement_quality"];
    score_source?: string;
    score?: number;
    band?: "A" | "B" | "C" | "D" | "E";
    fallbacks: { provider: string; reason: string }[];
    macro_context: MacroContextEvent[];
  };
  proposal?: {
    decision: "approve_as_requested" | "counteroffer" | "decline_review";
    human_required: true;
    requested_usd?: number;
    recommended_usd?: number;
    supportable_usd?: number;
    proposed_usd?: number;
    binding_method?: "needs_based" | "working_capital" | "net_worth" | "bureau_recommendation";
    higher_limit_note: boolean;
    macro_haircut_applied: boolean;
    reason_codes: string[];
    /** Working shown in the memo: needs, each cap, cap after band and macro. */
    needs_usd?: number;
    caps?: { working_capital?: number; net_worth?: number; bureau_recommendation?: number };
    risk_adjusted_cap_usd?: number;
  };
}
