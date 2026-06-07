#!/usr/bin/env node
// B0 Phase 4g — backfill customers.payment_* for ALL customers using the REAL skill.
// Mirrors exactly what ar-aging-agent does (analysePaymentBehaviour) but across the
// whole portfolio, not just the high-utilization subset. One-time backfill; ongoing
// coverage is the future Payment Behaviour Monitor's job (backlog C3).
//
// Run:  npx tsx tests/payments/backfill-payment-health.mjs
// Requires DATABASE_URL. Reads transactions, computes, EMITS dry-run SQL to
// backfill_payment_health.sql (ends in ROLLBACK). Inspect, then flip to COMMIT.
//
// NOTE on amount: AR currently selects the dropped `amount` column (bug F3), so it
// equal-weights. We read amount_paid and map to the skill's `amount` = the
// amount-weighted truth. Verified non-tipping vs AR's equal-weighting on this data,
// so labels match what AR would write; values (rates/avgs) are the correct weighted ones.

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dir, "../../supabase/functions/_shared/skills/analytical/analyse-payment-behaviour.ts");
const { analysePaymentBehaviour } = await import(SKILL);

const DBURL = process.env.DATABASE_URL;
if(!DBURL){ console.error("Set DATABASE_URL"); process.exit(1); }

function q(sql){
  const out = execSync(`psql "${DBURL}" -At -F '\t' -c "${sql.replace(/"/g,'\\"')}"`).toString().trim();
  return out ? out.split("\n").map(r=>r.split("\t")) : [];
}

// all customers (so customers with zero txns get health='unknown' written too)
const custs = q(`SELECT id, company_name FROM customers ORDER BY company_name`);
const txnRows = q(`SELECT customer_id, payment_date, amount_paid, days_to_pay, days_early_late, on_time
                   FROM payment_transactions`);
const byCust = {};
for(const [cid,pd,amt,dtp,del,ot] of txnRows){
  (byCust[cid] ??= []).push({
    payment_date:pd, amount:Number(amt), days_to_pay:Number(dtp)||0,
    days_early_late:Number(del), on_time: ot==='t'
  });
}

function sqlStr(v){ return v===null||v===undefined ? "NULL" : `'${String(v).replace(/'/g,"''")}'`; }
function sqlNum(v){ return v===null||v===undefined ? "NULL" : Number(v); }

let sql = `-- B0 Phase 4g: backfill customers.payment_* across ALL customers via real skill.\n`;
sql += `-- DRY RUN: ends with ROLLBACK. Flip to COMMIT after review.\n\nBEGIN;\n\n`;
const summary = {};
for(const [cid,name] of custs){
  const txns = byCust[cid] || [];
  const r = analysePaymentBehaviour(txns);
  summary[r.health] = (summary[r.health]||0)+1;
  sql += `UPDATE customers SET `
      + `payment_on_time_rate=${sqlNum(r.on_time_rate)}, `
      + `payment_avg_days_early_late=${sqlNum(r.avg_days_early_late)}, `
      + `payment_trend=${sqlStr(r.trend)}, `
      + `payment_health=${sqlStr(r.health)}, `
      + `payment_behaviour_updated_at=now() `
      + `WHERE id='${cid}'; `
      + `-- ${name}: ${r.health}/${r.trend}\n`;
}
sql += `\n-- spread after backfill\n`;
sql += `SELECT payment_health, payment_trend, count(*) AS n FROM customers GROUP BY 1,2 ORDER BY n DESC;\n\n`;
sql += `ROLLBACK;\n`;
writeFileSync(resolve(__dir,"backfill_payment_health.sql"), sql);

console.log("Computed payment_health for", custs.length, "customers");
console.log("Spread:", JSON.stringify(summary));
console.log("Wrote backfill_payment_health.sql (dry-run, ROLLBACK).");
