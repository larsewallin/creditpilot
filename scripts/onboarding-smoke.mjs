#!/usr/bin/env node
// Real-data smoke run for onboarding (not a commit gate; real sources change).
// Signs in as a demo user and submits four real companies through the deployed
// `onboarding` function, then prints what each stage concluded.
//
//   ONB_EMAIL=... ONB_PASSWORD=... node scripts/onboarding-smoke.mjs staging|prod
//
// Creates prospect rows (lifecycle_status = 'prospect') in that environment.
// Remove them afterwards with scripts/onboarding-smoke-cleanup.sql.
import { readFileSync } from "fs";

const env = process.argv[2];
const PROJECTS = {
  staging: { url: "https://mwyezrnolctipbcwqubg.supabase.co", key: (readFileSync(".env", "utf8").match(/^VITE_SUPABASE_PUBLISHABLE_KEY=["']?([^"'\n]+)/m) ?? [])[1] },
  prod: { url: "https://yxqudytimmxufypothis.supabase.co", key: "sb_publishable_Rox6YheHUmdBSk7hoXcrxQ_HAHuFcQU" },
};
const p = PROJECTS[env];
if (!p?.key) { console.error("Usage: ONB_EMAIL=… ONB_PASSWORD=… node scripts/onboarding-smoke.mjs staging|prod"); process.exit(1); }
const { ONB_EMAIL: email, ONB_PASSWORD: password } = process.env;
if (!email || !password) { console.error("Set ONB_EMAIL and ONB_PASSWORD (use read -s for the password)."); process.exit(1); }

const auth = await fetch(`${p.url}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: p.key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
}).then((r) => r.json());
if (!auth.access_token) { console.error("Sign-in failed:", auth.error_description ?? auth.msg ?? auth); process.exit(1); }

const refs = [{ company_name: "Reference One" }, { company_name: "Reference Two" }, { company_name: "Reference Three" }];
const base = { trade_references: refs, signatures: { terms: true, credit_check_consent: true }, financial_statements: [] };
const cases = [
  { label: "UK company (Companies House, officers, PSC owners)", application: { ...base,
    legal_name: "Tesco PLC", country_code: "GB", registration_no: "00445790", entity_type: "plc", is_public: true, website: "tesco.com",
    people: [], credit_request: { amount_usd: 200000, terms_days: 30, monthly_purchases_usd: 150000, invoicing_currency: "GBP" } } },
  { label: "US public company (SEC EDGAR financials)", application: { ...base,
    legal_name: "Apple Inc.", country_code: "US", is_public: true, cik: "320193", ticker: "AAPL", tax_id: "94-2404110", website: "apple.com",
    people: [{ name: "Tim Cook", role: "officer" }], credit_request: { amount_usd: 500000, terms_days: 45, monthly_purchases_usd: 300000, invoicing_currency: "USD" } } },
  { label: "German company (VIES VAT, GLEIF)", application: { ...base,
    legal_name: "SAP SE", country_code: "DE", tax_id: "DE143454214", entity_type: "other", website: "sap.com", is_public: false,
    people: [], credit_request: { amount_usd: 100000, terms_days: 60, monthly_purchases_usd: 50000, invoicing_currency: "EUR" },
    financial_statements: [{ period_end: "2025-12-31", statement_quality: "audited", currency: "USD", current_assets: 20e9, current_liabilities: 15e9, total_assets: 75e9, total_liabilities: 30e9, equity: 45e9 }] } },
  { label: "Listed entity (must stop at Screening)", application: { ...base,
    legal_name: "Rosneft Oil Company", country_code: "RU", website: "rosneft.com", people: [],
    credit_request: { amount_usd: 100000, terms_days: 30, monthly_purchases_usd: 50000, invoicing_currency: "USD" } } },
];

for (const c of cases) {
  const r = await fetch(`${p.url}/functions/v1/onboarding`, {
    method: "POST", headers: { apikey: p.key, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "submit", application: c.application }),
  });
  const j = await r.json();
  console.log(`\n=== ${c.label}  [HTTP ${r.status}]`);
  if (j.error) { console.log("  error:", j.error); continue; }
  const o = j.outcome;
  console.log("  stopped at:", o.stopped_at, "| events:", o.events.join(", "));
  if (o.screening) console.log("  screening:", o.screening.status, "| checks:", o.screening.checks.join(", "), "| people:", o.screening.people_screened,
    "| flags:", o.screening.fraud_flags.join(", ") || "none", "| hits:", o.screening.hits.map((h) => `${h.subject} ~ ${h.list_entry} (${h.list} ${h.similarity})`).join("; ") || "none");
  if (o.analysis) console.log("  analysis: financials", o.analysis.financials_source, o.analysis.statement_quality ?? "", "| score", o.analysis.score ?? "none", o.analysis.score_source ?? "",
    "| fallbacks:", o.analysis.fallbacks.map((f) => `${f.provider}:${f.reason}`).join(", ") || "none", "| macro:", o.analysis.macro_context.map((m) => `${m.key} ${m.severity}`).join(", ") || "none");
  if (o.proposal) console.log("  proposal:", o.proposal.decision, "| proposed", o.proposal.proposed_usd ?? "-", "| supportable", o.proposal.supportable_usd ?? "-", "| reasons:", o.proposal.reason_codes.join(", "));
  if (j.proposal_action) console.log("  CIA action:", j.proposal_action.error ? `ERROR ${j.proposal_action.error}` : `${j.proposal_action.severity} | ${j.proposal_action.headline}`);
}
