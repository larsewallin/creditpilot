#!/usr/bin/env node
// Decision-step smoke run (after scripts/onboarding-smoke.mjs). Not a commit gate.
// Signs in as the credit manager and:
//   1. approves the SAP proposal at the proposed amount,
//   2. tries to approve the Rosneft proposal (must be refused: open sanctions match),
//   3. checks SAP is now an active customer with that limit and a baseline,
//   4. checks a signed-out visitor cannot see the proposals.
//
//   ONB_EMAIL=credit.manager@demo.example.com ONB_PASSWORD=... node scripts/onboarding-decide-smoke.mjs staging|prod
import { readFileSync } from "fs";

const env = process.argv[2];
const PROJECTS = {
  staging: { url: "https://mwyezrnolctipbcwqubg.supabase.co", key: (readFileSync(".env", "utf8").match(/^VITE_SUPABASE_PUBLISHABLE_KEY=["']?([^"'\n]+)/m) ?? [])[1] },
  prod: { url: "https://yxqudytimmxufypothis.supabase.co", key: "sb_publishable_Rox6YheHUmdBSk7hoXcrxQ_HAHuFcQU" },
};
const p = PROJECTS[env];
const { ONB_EMAIL: email, ONB_PASSWORD: password } = process.env;
if (!p?.key || !email || !password) { console.error("Usage: ONB_EMAIL=… ONB_PASSWORD=… node scripts/onboarding-decide-smoke.mjs staging|prod"); process.exit(1); }

const auth = await fetch(`${p.url}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: p.key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
}).then((r) => r.json());
if (!auth.access_token) { console.error("Sign-in failed:", auth.error_description ?? auth.msg ?? auth); process.exit(1); }
const user = { apikey: p.key, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" };
const rest = (path, headers = user) => fetch(`${p.url}/rest/v1/${path}`, { headers }).then((r) => r.json());
const decide = (body) => fetch(`${p.url}/functions/v1/onboarding`, { method: "POST", headers: user, body: JSON.stringify({ action: "decide", ...body }) })
  .then(async (r) => ({ status: r.status, ...(await r.json()) }));

const actions = await rest("pending_actions?select=id,proposed_value,requested_value,severity,memo,customer_id,customers(company_name)&action_type=eq.NEW_CREDIT_LIMIT&status=eq.pending&order=created_at.desc");
console.log(`Pending new-customer proposals: ${actions.length}`);
for (const a of actions) console.log(`  ${a.customers?.company_name}: ${a.memo?.headline} [${a.severity}]`);

const find = (name) => actions.find((a) => (a.customers?.company_name ?? "").includes(name));
const sap = find("SAP");
const ros = find("Rosneft");

if (ros) {
  const r = await decide({ pending_action_id: ros.id, decision: "approve", approved_value: 50000, note: "Smoke test: this approval must be refused." });
  console.log(`\nRosneft approve attempt -> HTTP ${r.status}: ${r.error ?? "NOT REFUSED (problem)"}`);
}
if (sap) {
  const r = await decide({ pending_action_id: sap.id, decision: "approve" });
  console.log(`SAP approve -> HTTP ${r.status}: ${r.error ?? `approved ${r.approved_limit_usd}, baseline ${r.baseline_id}`}`);
  const [c] = await rest(`customers?select=company_name,lifecycle_status,credit_limit,payment_terms_days&id=eq.${sap.customer_id}`);
  console.log(`SAP customer now: ${c?.lifecycle_status}, limit ${c?.credit_limit}, terms ${c?.payment_terms_days}`);
  const base = await rest(`underwriting_baseline?select=approved_limit_usd,assumptions&customer_id=eq.${sap.customer_id}`);
  console.log(`Baseline rows: ${base.length}; band ${base[0]?.assumptions?.band}, macro keys ${(base[0]?.assumptions?.macro_context_at_approval ?? []).map((m) => m.key).join(",")}`);
}

const anon = { apikey: p.key, Authorization: `Bearer ${p.key}` };
const anonActions = await rest("pending_actions?select=id&action_type=eq.NEW_CREDIT_LIMIT", anon);
const anonProspects = await rest("customers?select=id&lifecycle_status=eq.prospect", anon);
console.log(`\nSigned-out visitor sees ${Array.isArray(anonActions) ? anonActions.length : "?"} proposals and ${Array.isArray(anonProspects) ? anonProspects.length : "?"} prospects (both must be 0).`);
