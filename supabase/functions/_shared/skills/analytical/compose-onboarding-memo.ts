/**
 * @skill compose-onboarding-memo
 * @type analytical
 * @description Writes the credit memo a person reads before approving a new
 *   customer's first limit. Deterministic: every sentence comes from the
 *   pipeline outcome, nothing is generated, so the memo can never state a
 *   figure the analysis did not produce. Each section names its sources
 *   (SEC filing, uploaded statements, File, bureau report, registry, VAT check,
 *   sanctions lists, Country / FX / Industry agent signals).
 *
 * @input  CreditApplication + OnboardingOutcome (from the onboarding pipeline)
 * @output OnboardingMemo { headline, recommendation, sections[], text }
 * @usedBy cia-agent onboarding mode (pending_actions.memo / rationale)
 */
import type { CreditApplication, OnboardingOutcome } from "../../onboarding/types.ts";

export interface MemoSection { title: string; lines: string[]; sources: string[] }
export interface OnboardingMemo {
  headline: string;
  recommendation: "approve_as_requested" | "counteroffer" | "decline_review";
  sections: MemoSection[];
  text: string;
}

export const REASON_TEXT: Record<string, string> = {
  HIGHER_LIMIT_SUPPORTABLE: "The evidence supports a higher limit than requested.",
  LIMIT_CAPPED_WORKING_CAPITAL: "Working capital caps the limit below the applicant's needs.",
  LIMIT_CAPPED_NET_WORTH: "Net worth caps the limit below the applicant's needs.",
  LIMIT_CAPPED_BUREAU_RECOMMENDATION: "The bureau's maximum credit recommendation caps the limit.",
  MACRO_COUNTRY_RISK: "A high or critical country-risk signal applies to the applicant's country.",
  MACRO_FX_RISK: "A high or critical FX signal applies to the invoicing currency.",
  STATEMENT_QUALITY_COMPILED: "Statements are compiled (no accountant assurance), so balance-sheet caps are halved.",
  SCORE_FALLBACK: "The preferred score source was unavailable; a fallback source was used.",
  SANCTIONS_MATCH: "A party matches a sanctions list entry.",
  NO_SCORE_AVAILABLE: "No credit score could be obtained from any configured source.",
  NO_CAP_BASIS: "There are no financial statements or bureau recommendation to base a limit on.",
  SCORE_BAND_E: "The score is in band E (below 60), which supports no unsecured limit.",
  NO_SUPPORTABLE_LIMIT: "The evidence supports no limit.",
};

const usd = (n?: number) => (n === undefined || n === null ? "n/a" : `$${Math.round(n).toLocaleString("en-US")}`);
const FIN_SOURCE: Record<string, string> = { sec_edgar: "SEC EDGAR (10-K, XBRL)", uploaded_statements: "Statements uploaded with the application", none: "None" };
const SCORE_SOURCE: Record<string, string> = { file: "File scoring app", bureau_report: "Uploaded bureau report" };
const AGENT: Record<string, string> = { country_risk_agent: "Country Risk agent", fx_risk_agent: "FX Risk agent", industry_risk_agent: "Industry Risk agent", news_agent: "News agent" };
const CHECK: Record<string, string> = {
  "registry:companies_house": "Companies House", "registry:sec_edgar": "SEC EDGAR", "registry:gleif": "GLEIF (LEI register)",
  "registry:state_registry": "State registry", "registry:national_registry": "National registry",
  "tax_id:vies": "EU VIES VAT check", "tax_id:hmrc_vat": "HMRC VAT check", "tax_id:ein_format": "EIN format check",
  domain_age: "Domain registration date (RDAP)", sanctions_entity: "Entity against OFAC, EU, UK and UN lists",
  sanctions_people: "People against OFAC, EU, UK and UN lists",
};

export function composeOnboardingMemo(app: CreditApplication, o: OnboardingOutcome): OnboardingMemo {
  const p = o.proposal;
  if (!p) throw new Error("composeOnboardingMemo: outcome has no proposal");
  const requested = p.requested_usd ?? app.credit_request.amount_usd;
  const sections: MemoSection[] = [];

  let headline: string;
  if (p.decision === "approve_as_requested") headline = `Approve ${usd(p.proposed_usd)} as requested`;
  else if (p.decision === "counteroffer") headline = `Counteroffer ${usd(p.proposed_usd)} (requested ${usd(requested)})`;
  else if (p.reason_codes.includes("SANCTIONS_MATCH")) headline = "Decline for review: sanctions match";
  else headline = "Refer to a person: no limit can be supported automatically";
  if (p.higher_limit_note) headline += `; up to ${usd(p.supportable_usd)} is supportable`;

  sections.push({
    title: "Recommendation",
    lines: [
      `${app.legal_name} (${app.country_code ?? "country n/a"}) requests ${usd(requested)} on ${app.credit_request.terms_days ?? 30}-day terms` +
        (app.credit_request.invoicing_currency ? `, invoiced in ${app.credit_request.invoicing_currency}.` : "."),
      `${headline}.`,
      ...p.reason_codes.map((c) => REASON_TEXT[c] ?? c),
      "A person must approve; nothing is granted automatically.",
    ],
    sources: [],
  });

  if (p.needs_usd !== undefined && p.risk_adjusted_cap_usd !== undefined) {
    const caps = p.caps ?? {};
    const lines = [
      `Needs: ${usd(app.credit_request.monthly_purchases_usd)} monthly purchases × ${app.credit_request.terms_days ?? 30}/30 days + buffer = ${usd(p.needs_usd)}.`,
    ];
    if (caps.working_capital !== undefined) lines.push(`Working-capital cap: ${usd(caps.working_capital)}.`);
    if (caps.net_worth !== undefined) lines.push(`Net-worth cap: ${usd(caps.net_worth)}.`);
    if (caps.bureau_recommendation !== undefined) lines.push(`Bureau / File maximum credit recommendation: ${usd(caps.bureau_recommendation)}.`);
    lines.push(`After score band ${o.analysis?.band ?? "n/a"}${p.macro_haircut_applied ? " and the macro haircut" : ""}: ${usd(p.risk_adjusted_cap_usd)} (supportable ${usd(p.supportable_usd)}).`);
    lines.push(`Recommended: ${usd(p.recommended_usd)}, bound by ${(p.binding_method ?? "n/a").replace(/_/g, " ")}.`);
    sections.push({ title: "Limit working", lines, sources: ["Company onboarding limit policy (Settings › Onboarding)"] });
  }

  if (o.analysis) {
    const a = o.analysis;
    const lines = [
      `Financials: ${FIN_SOURCE[a.financials_source ?? "none"] ?? a.financials_source}${a.statement_quality ? ` (${a.statement_quality})` : ""}.`,
      a.score !== undefined ? `Score: ${a.score} (band ${a.band}) from ${SCORE_SOURCE[a.score_source ?? ""] ?? a.score_source}.` : "Score: none available.",
      ...a.fallbacks.map((f) => `Fallback: ${f.provider.replace(/_/g, " ")} was ${f.reason.replace(/_/g, " ")}.`),
    ];
    const sources = [FIN_SOURCE[a.financials_source ?? "none"], a.score_source ? SCORE_SOURCE[a.score_source] ?? a.score_source : undefined]
      .filter((x): x is string => !!x && x !== "None");
    if (app.bureau_report) sources.push(`${app.bureau_report.bureau} report (uploaded)`);
    sections.push({ title: "Credit analysis", lines, sources: [...new Set(sources)] });

    sections.push({
      title: "Market context",
      lines: a.macro_context.length
        ? a.macro_context.map((m) => `${m.severity.toUpperCase()}: ${m.title} (${m.key}).`)
        : ["No current country, currency or industry signals for this applicant."],
      sources: [...new Set(a.macro_context.map((m) => AGENT[m.source_agent] ?? m.source_agent))],
    });
  }

  if (o.screening) {
    const s = o.screening;
    const lines = [
      `Screening ${s.status}: the entity and ${s.people_screened} ${s.people_screened === 1 ? "person" : "people"} screened.`,
      ...s.hits.map((h) => `${h.status === "cleared" ? "Cleared by a person" : h.status === "confirmed" ? "Confirmed" : "Open"}: ${h.subject} ~ ${h.list_entry} on the ${h.list} list (similarity ${h.similarity}${h.list_country ? `, listed country ${h.list_country}` : ""}${h.list_dob ? `, born ${h.list_dob}` : ""}).`),
      ...(s.fraud_flags.length ? [`Fraud flags: ${s.fraud_flags.map((f) => f.toLowerCase().replace(/_/g, " ")).join(", ")}.`] : []),
      ...s.checks.filter((c) => c.startsWith("registry_unavailable")).map((c) => `Registry could not be checked (${c.split(":")[1]?.replace(/_/g, " ") ?? "unavailable"}).`),
    ];
    sections.push({
      title: "Screening",
      lines,
      sources: s.checks.map((c) => CHECK[c]).filter((x): x is string => !!x),
    });
  }

  const text = [headline, ...sections.map((sec) =>
    `${sec.title}\n${sec.lines.map((l) => `- ${l}`).join("\n")}${sec.sources.length ? `\nSources: ${sec.sources.join("; ")}` : ""}`)].join("\n\n");
  return { headline, recommendation: p.decision, sections, text };
}
