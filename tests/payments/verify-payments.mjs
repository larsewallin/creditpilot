#!/usr/bin/env node
// B0 Phase 4g verifier — Path 2: imports the REAL analyse-payment-behaviour skill
// and checks each customer's COMPUTED health/trend against the intended persona.
//
// Run with:  npx tsx tests/payments/verify-payments.mjs
// (tsx lets Node import the .ts skill unchanged — no drift, no Deno.)
//
// Requires DATABASE_URL in env (same as psql). Reads payment_transactions back
// AFTER you've applied the regen SQL (COMMIT version).

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
// adjust if your skill path differs:
const SKILL = resolve(__dir, "../../supabase/functions/_shared/skills/analytical/analyse-payment-behaviour.ts");
const { analysePaymentBehaviour } = await import(SKILL);

const DBURL = process.env.DATABASE_URL;
if(!DBURL){ console.error("Set DATABASE_URL"); process.exit(1); }

// Intended persona per customer — keep in sync with the generator's assign().
const INTENDED = JSON.parse(execSync(`cat ${resolve(__dir,"intended.json")}`).toString());

function q(sql){
  const out = execSync(`psql "${DBURL}" -At -F '\t' -c "${sql.replace(/"/g,'\\"')}"`).toString().trim();
  return out ? out.split("\n").map(r=>r.split("\t")) : [];
}

const rows = q(`SELECT customer_id, payment_date, amount_paid, days_early_late, on_time
                FROM payment_transactions ORDER BY customer_id, payment_date`);
const byCust = {};
for(const [cid,pd,amt,del,ot] of rows){
  (byCust[cid] ??= []).push({
    payment_date:pd, amount:Number(amt), days_to_pay:0,
    days_early_late:Number(del), on_time: ot==='t'
  });
}

let pass=0, fail=0;
const fails=[];
for(const c of INTENDED){
  const txns = byCust[c.id] || [];
  const r = analysePaymentBehaviour(txns);
  const okH = r.health === c.intendedHealth;
  if(okH) pass++; else { fail++; fails.push({...c, got:r.health, trend:r.trend,
    on_time_rate:r.on_time_rate, avg:r.avg_days_early_late}); }
}
console.log(`\nPayment behaviour verification: ${pass}/${INTENDED.length} match intended health`);
if(fails.length){
  console.log("\nMISMATCHES:");
  for(const f of fails)
    console.log(`  ${f.name}: intended=${f.intendedHealth} got=${f.got} (trend=${f.trend}, on_time=${f.on_time_rate}, avg=${f.avg})`);
  process.exit(1);
}
console.log("All customers compute to intended health. ✅");
