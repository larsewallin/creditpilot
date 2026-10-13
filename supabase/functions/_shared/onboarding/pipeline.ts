/**
 * New Customer Onboarding pipeline core (pure orchestration, injected providers).
 *
 * Stages: completeness → screening → analysis → decision proposal.
 * Approval, conditions and activation happen after a person acts on the
 * proposal (CIA NEW_CREDIT_LIMIT pending_action), outside this function.
 *
 * Nothing here writes to the database or calls the network directly: every
 * outside answer comes from `providers`, and the returned outcome lists the
 * events the caller publishes (via publishEvent) and what it stores. The
 * golden-prospect harness (tests/onboarding) runs this exact code with
 * fixture providers.
 *
 * Rules and numbers: tests/onboarding/README.md and settings.ts.
 */
import type {
  CreditApplication, FinancialStatement, FraudFlag, MacroContextEvent, OnboardingOutcome,
  OnboardingProviders, OnboardingSettings, Person, ScreeningHit,
} from "./types.ts";
import { ONBOARDING_DEFAULTS } from "./settings.ts";
import { calculateOnboardingLimit, scoreToBand } from "../skills/analytical/calculate-onboarding-limit.ts";
import { matchSanctionsName, normalize, prepareSanctionsList, type PreparedEntry } from "../skills/analytical/match-sanctions-name.ts";

export interface RunOptions {
  settings?: OnboardingSettings;
  /** ISO date used for entity age, domain age and clocks. Defaults to today. */
  asOf?: string;
  /** Decisions a person already made at Screening, so a re-run does not raise them again.
   *  The agent never fills this; only a disposition by a signed-in user does. */
  cleared?: {
    hits?: { subject: string; list_entry: string }[];
    fraud_flags_accepted?: boolean;
  };
}

const REG_B_INCOMPLETE_DAYS = 30;

export async function runOnboarding(
  app: CreditApplication,
  providers: OnboardingProviders,
  opts: RunOptions = {},
): Promise<OnboardingOutcome> {
  const settings = opts.settings ?? ONBOARDING_DEFAULTS;
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const out: OnboardingOutcome = {
    application_id: app.application_id,
    stopped_at: "application",
    events: ["APPLICATION_SUBMITTED"],
  };

  // ─── 1. Existing customer: never create a duplicate ────────────────────────
  const existing = await providers.findExistingCustomer(app);
  if (existing) {
    out.stopped_at = "completeness";
    out.route = "existing_customer_limit_review";
    out.duplicate_of = existing.customer_id;
    return out;
  }
  out.route = "new_customer";

  // ─── 2. Completeness ───────────────────────────────────────────────────────
  out.stopped_at = "completeness";
  const missing = completenessGaps(app, settings, asOf);
  if (missing.length) {
    out.completeness = { status: "incomplete", missing, reg_b_clock_days: REG_B_INCOMPLETE_DAYS };
    out.events.push("APPLICATION_INCOMPLETE");
    return out;
  }
  out.completeness = { status: "complete", missing: [] };

  // ─── 3. Screening ──────────────────────────────────────────────────────────
  out.stopped_at = "screening";
  const screening = await screen(app, providers, settings, asOf, opts.cleared);
  out.screening = screening;
  if (screening.status === "fail") {
    out.events.push("SANCTIONS_HIT");
    out.proposal = {
      decision: "decline_review", human_required: true,
      requested_usd: app.credit_request.amount_usd,
      higher_limit_note: false, macro_haircut_applied: false,
      reason_codes: ["SANCTIONS_MATCH"],
    };
    return out;
  }
  if (screening.status === "review") {
    out.events.push("SCREENING_REVIEW");
    return out;
  }
  out.events.push("SCREENING_PASS");

  // ─── 4. Analysis ───────────────────────────────────────────────────────────
  out.stopped_at = "analysis";
  const fallbacks: { provider: string; reason: string }[] = [];

  let financials_source: "uploaded_statements" | "sec_edgar" | "none" = "none";
  let statement: FinancialStatement | undefined;
  if (app.is_public) {
    const pub = await providers.publicFinancials(app);
    if (Array.isArray(pub) && pub.length) { statement = latest(pub); financials_source = "sec_edgar"; }
    else fallbacks.push({ provider: "sec_edgar", reason: Array.isArray(pub) ? "not_found" : pub.error });
  }
  if (!statement && app.financial_statements.length) {
    statement = latest(app.financial_statements);
    financials_source = "uploaded_statements";
  }
  // Balance-sheet caps need USD figures. Conversion arrives with the FX adapter;
  // until then a non-USD statement is shown but not used for caps.
  let capStatement = statement;
  if (statement && statement.currency.toUpperCase() !== "USD") {
    fallbacks.push({ provider: "statements", reason: "currency_conversion_needed" });
    capStatement = undefined;
  }

  let score: number | undefined;
  let score_source: string | undefined;
  const maxCredit: number[] = [];
  for (const source of settings.sources.score_order) {
    if (source === "file") {
      const r = await providers.fileScore(app, statement ? [statement] : app.financial_statements);
      if ("error" in r) { fallbacks.push({ provider: "file", reason: r.error }); continue; }
      score = r.score; score_source = "file";
      if (r.max_credit_recommendation_usd !== undefined) maxCredit.push(r.max_credit_recommendation_usd);
      break;
    }
    if (source === "bureau_report") {
      if (!app.bureau_report) { fallbacks.push({ provider: "bureau_report", reason: "not_found" }); continue; }
      score = app.bureau_report.score_normalized; score_source = "bureau_report";
      break;
    }
  }
  if (app.bureau_report?.max_credit_recommendation_usd !== undefined) maxCredit.push(app.bureau_report.max_credit_recommendation_usd);
  const band = scoreToBand(score);

  const currency = app.credit_request.invoicing_currency?.toUpperCase();
  const macro_context = await providers.macroContext(app.country_code, app.sector, currency);
  const severe = (e: MacroContextEvent) => e.severity === "high" || e.severity === "critical";
  const macro = {
    country: macro_context.some((e) => e.source_agent === "country_risk_agent" && e.key === app.country_code && severe(e)),
    fx: !!currency && currency !== "USD" && macro_context.some((e) => e.source_agent === "fx_risk_agent" && e.key === currency && severe(e)),
  };

  out.analysis = {
    financials_source,
    statement_quality: statement?.statement_quality,
    score_source, score, band: band ?? undefined,
    fallbacks, macro_context,
  };

  // ─── 5. Decision proposal (a person always approves) ───────────────────────
  const limit = calculateOnboardingLimit({
    requested_usd: app.credit_request.amount_usd ?? 0,
    monthly_purchases_usd: app.credit_request.monthly_purchases_usd,
    terms_days: app.credit_request.terms_days,
    statement: capStatement,
    max_credit_recommendations_usd: maxCredit,
    band,
    macro,
    limits: settings.limits,
  });
  const reason_codes = [...limit.reason_codes];
  if (score_source && score_source !== settings.sources.score_order[0]) reason_codes.push("SCORE_FALLBACK");

  out.stopped_at = "decision";
  out.events.push("CREDIT_ANALYSIS_COMPLETE");
  out.proposal = {
    decision: limit.decision, human_required: true,
    requested_usd: limit.requested_usd,
    recommended_usd: limit.recommended_usd,
    supportable_usd: limit.supportable_usd,
    proposed_usd: limit.proposed_usd,
    binding_method: limit.binding_method,
    higher_limit_note: limit.higher_limit_note,
    macro_haircut_applied: limit.macro_haircut_applied,
    reason_codes,
    needs_usd: limit.needs_usd,
    caps: limit.caps,
    risk_adjusted_cap_usd: limit.risk_adjusted_cap_usd,
  };
  return out;
}

// ─── Completeness ────────────────────────────────────────────────────────────

function completenessGaps(app: CreditApplication, s: OnboardingSettings, asOf: string): string[] {
  const missing: string[] = [];
  if (!app.legal_name?.trim()) missing.push("legal_name");
  if (!app.country_code) missing.push("country_code");
  if (!app.credit_request.amount_usd) missing.push("credit_request.amount_usd");
  if ((app.trade_references?.length ?? 0) < s.template.min_trade_references) missing.push("trade_references");
  if (!app.is_public && (app.credit_request.amount_usd ?? 0) > s.template.statements_required_above_usd && !app.financial_statements.length) {
    missing.push("financial_statements");
  }
  const age = app.date_established ? monthsBetween(app.date_established, asOf) : undefined;
  const needsGuarantee = app.entity_type === "sole_proprietor" ||
    (age !== undefined && age < s.template.guarantee_required_if_entity_younger_than_months);
  if (needsGuarantee && !app.signatures.personal_guarantee) missing.push("personal_guarantee");
  if (!app.signatures.terms) missing.push("signature_terms");
  return missing;
}

// ─── Screening ───────────────────────────────────────────────────────────────

async function screen(app: CreditApplication, providers: OnboardingProviders, s: OnboardingSettings, asOf: string, cleared?: RunOptions["cleared"]) {
  const checks: string[] = [];
  const fraud_flags: FraudFlag[] = [];

  const registry = await providers.lookupRegistry(app);
  checks.push(`registry:${registry.source}`);
  if (registry.unavailable) checks.push(registry.unavailable_reason ? `registry_unavailable:${registry.unavailable_reason}` : "registry_unavailable");
  else if (!registry.found) fraud_flags.push("REGISTRY_NOT_FOUND");
  if (registry.found && registry.status && registry.status !== "active") fraud_flags.push("REGISTRY_INACTIVE");

  const tax = await providers.checkTaxId(app);
  if (tax) { checks.push(`tax_id:${tax.source}`); if (!tax.valid) fraud_flags.push("TAX_ID_INVALID"); }

  if (app.website) {
    checks.push("domain_age");
    const months = await providers.domainAgeMonths(app.website);
    if (months !== null && months < s.screening.new_domain_months) fraud_flags.push("NEW_DOMAIN");
  }

  const formed = registry.formation_date ?? app.date_established;
  if (formed && monthsBetween(formed, asOf) < s.screening.young_entity_months &&
      (app.credit_request.amount_usd ?? 0) > s.screening.young_entity_large_request_usd) {
    fraud_flags.push("YOUNG_ENTITY_LARGE_REQUEST");
  }
  if (registry.formation_date && app.date_established && registry.formation_date !== app.date_established) {
    fraud_flags.push("FORMATION_DATE_MISMATCH");
  }
  if (app.address_type && app.address_type !== "commercial") fraud_flags.push("ADDRESS_RISK");

  // Sanctions: entity names, then every person from the application and registry.
  const people = dedupePeople([...app.people, ...(registry.officers ?? []), ...(registry.owners ?? [])]);
  const entityNames = [app.legal_name, app.trade_name, registry.legal_name].filter(Boolean) as string[];
  const list = prepareSanctionsList(await providers.sanctionsList([...entityNames, ...people.map((p) => p.name)]));
  const hits: (ScreeningHit & { country_match: boolean })[] = [];

  checks.push("sanctions_entity");
  const seenEntity = new Set<string>();
  for (const name of entityNames) {
    const key = normalize(name, "entity").join(" ");
    if (seenEntity.has(key)) continue;
    seenEntity.add(key);
    const h = bestMatch(name, "entity", app.country_code, list, s);
    if (h) hits.push(h);
  }

  checks.push("sanctions_people");
  for (const p of people) {
    const h = bestMatch(p.name, "person", p.country_code, list, s, p.date_of_birth);
    if (h) hits.push(h);
  }

  const isCleared = (h: ScreeningHit) => (cleared?.hits ?? []).some((c) => c.subject === h.subject && c.list_entry === h.list_entry);
  const open = hits.filter((h) => !isCleared(h));
  const flagsOpen = !cleared?.fraud_flags_accepted;
  // A hit (fail) needs a near-exact name AND a second identifier: the country for an
  // entity; for a person, country and year of birth. Anything less is a review.
  const hardHit = open.some((h) => h.similarity >= s.screening.name_match_hit_threshold && h.country_match &&
    (h.subject_type === "entity" || h.dob_match === true));
  const forceReview = flagsOpen && fraud_flags.includes("REGISTRY_INACTIVE");
  const status: "pass" | "review" | "fail" = hardHit ? "fail"
    : open.length || forceReview || (flagsOpen && fraud_flags.length >= s.screening.fraud_flags_for_review) ? "review"
    : "pass";

  return {
    status,
    checks,
    people_screened: people.length,
    hits: hits.map(({ country_match: _c, ...h }) => (isCleared(h) ? { ...h, status: "cleared" as const } : h)),
    fraud_flags,
  };
}

function bestMatch(
  subject: string, type: "entity" | "person", country: string | undefined,
  list: PreparedEntry[], s: OnboardingSettings, dob?: string,
): (ScreeningHit & { country_match: boolean }) | null {
  const m = matchSanctionsName(subject, type, list, s.screening.name_match_review_threshold);
  if (!m) return null;
  const country_match = !!country && !!m.entry.country_code && country.toUpperCase() === m.entry.country_code.toUpperCase();
  return {
    subject, subject_type: type, list_entry: m.entry.name, list: m.entry.list,
    similarity: Math.round(m.score * 1000) / 1000,
    status: "open",
    list_country: m.entry.country_code, list_dob: m.entry.date_of_birth,
    country_match, dob_match: type === "person" ? yearsAgree(dob, m.entry.date_of_birth) : undefined,
  };
}

/** True when both dates of birth are known and share a year (lists often give only a year). */
function yearsAgree(a?: string, b?: string): boolean {
  const ya = new Set(a?.match(/\b(19|20)\d{2}\b/g) ?? []);
  return (b?.match(/\b(19|20)\d{2}\b/g) ?? []).some((y) => ya.has(y));
}

function dedupePeople(people: Person[]): Person[] {
  const seen = new Map<string, Person>();
  for (const p of people) {
    const k = personKey(p.name);
    if (!k) continue;
    const prev = seen.get(k);
    if (!prev) seen.set(k, { ...p });
    else if (!prev.country_code && p.country_code) prev.country_code = p.country_code;
  }
  return [...seen.values()];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function personKey(name: string): string {
  return normalize(name, "person").join(" ");
}

function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = to.slice(0, 10).split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

function latest(statements: FinancialStatement[]): FinancialStatement {
  return [...statements].sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
}
