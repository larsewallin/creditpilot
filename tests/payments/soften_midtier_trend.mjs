#!/usr/bin/env node
// Soften "walking wounded" (score >= 30) customers' deteriorating payment trend to
// stable, matching their same-scenario/similar-score peers who already sit at
// payment_health='watch' (e.g. Global Power Equipment Group, Kaman Corporation).
//
// Why: migration 20260922000000_payment_health_in_risk_gate.sql added
// payment_health='at_risk' as a high-risk gate. Because EVERY credit_deterioration/
// payment_issues/negative_news customer in the demo currently shows a deteriorating
// trend (not just the worst ones), the high-risk set ballooned from the locked
// design's 7 customers (all credit_rating_score < 30 — see
// CreditPilot_Risk_Ranking_Priority_V1.md) to 21+. Diagnostic query confirmed
// payment_health is the ONLY gate condition firing for these 15 mid-tier customers
// (no bankruptcy scenario/tag, no pre-petition AR, no GOING_CONCERN event) — so
// softening their payment trend alone removes them from the high-risk set cleanly,
// restoring the original locked 7.
//
// Approach: shift each customer's EARLY-half transactions' days_early_late (and
// days_to_pay) up to match their already-poor LATE-half average — i.e. "chronically
// late from the start" rather than "getting worse over time". On-time rate can only
// stay the same or decrease (never increase), so this can only land these customers
// in 'watch' (on_time_rate already ~0.12-0.25, well under the 0.70 watch threshold),
// never accidentally 'healthy'. Verified in-script against the real skill before any
// SQL is emitted.
//
// Run:  npx tsx tests/payments/soften_midtier_trend.mjs
// Requires DATABASE_URL. Reads transactions, computes and VERIFIES the new health
// for each customer via the real analysePaymentBehaviour skill, then EMITS dry-run
// SQL to soften_midtier_trend.sql (ends in ROLLBACK). Inspect, then flip to COMMIT.
// After applying, re-run tests/payments/backfill-payment-health.mjs to refresh the
// customers.payment_* columns from the updated payment_transactions.

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dir, "../../supabase/functions/_shared/skills/analytical/analyse-payment-behaviour.ts");
const { analysePaymentBehaviour } = await import(SKILL);

const DBURL = process.env.DATABASE_URL;
if (!DBURL) { console.error("Set DATABASE_URL"); process.exit(1); }

function q(sql) {
  const out = execSync(`psql "${DBURL}" -At -F '\t' -c "${sql.replace(/"/g, '\\"')}"`).toString().trim();
  return out ? out.split("\n").map(r => r.split("\t")) : [];
}

// Dynamic selection — not a hardcoded name list — matching exactly the diagnostic
// query already run and reviewed: at_risk customers whose score is at or above the
// original score<30 high-risk threshold, i.e. the "mid-tier" band that should be
// watch-level concern, not top-tier alert.
const targets = q(`
  SELECT id, company_name FROM customers
  WHERE payment_health = 'at_risk' AND credit_rating_score >= 30
  ORDER BY company_name
`);

if (targets.length === 0) {
  console.log("No mid-tier at_risk customers found — nothing to do.");
  process.exit(0);
}

const targetIds = targets.map(([id]) => id);
const inList = targetIds.map(id => `'${id}'`).join(",");
const txnRows = q(`
  SELECT id, customer_id, payment_date, amount_paid, days_to_pay, days_early_late, on_time
  FROM payment_transactions
  WHERE customer_id IN (${inList})
`);

const byCust = {};
for (const [id, cid, pd, amt, dtp, del, ot] of txnRows) {
  (byCust[cid] ??= []).push({
    id, payment_date: pd, amount: Number(amt),
    days_to_pay: Number(dtp) || 0, days_early_late: Number(del), on_time: ot === "t",
  });
}

function sqlBool(v) { return v ? "true" : "false"; }

let sql = `-- Soften mid-tier (score >= 30) at_risk customers' deteriorating trend to stable.\n`;
sql += `-- DRY RUN: ends with ROLLBACK. Flip to COMMIT after review.\n`;
sql += `-- After applying, re-run tests/payments/backfill-payment-health.mjs.\n\nBEGIN;\n\n`;

const report = [];

for (const [cid, name] of targets) {
  const txns = byCust[cid] || [];
  if (txns.length < 2) {
    report.push(`${name}: SKIPPED (fewer than 2 transactions)`);
    continue;
  }
  const sorted = [...txns].sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date));
  const total = sorted.length;
  const half = Math.ceil(total / 2);
  const earlyHalf = sorted.slice(0, half);
  const lateHalf = sorted.slice(half);
  const earlyAmount = earlyHalf.reduce((s, t) => s + t.amount, 0);
  const lateAmount = lateHalf.reduce((s, t) => s + t.amount, 0);
  const earlyAvg = earlyHalf.reduce((s, t) => s + t.days_early_late * t.amount, 0) / earlyAmount;
  const lateAvg = lateHalf.reduce((s, t) => s + t.days_early_late * t.amount, 0) / lateAmount;
  const delta = lateAvg - earlyAvg;

  if (delta <= 3) {
    report.push(`${name}: SKIPPED (already stable/improving, delta=${delta.toFixed(1)})`);
    continue;
  }

  const shift = Math.round(delta);
  const adjustedEarly = earlyHalf.map(t => {
    const newDel = t.days_early_late + shift;
    return {
      ...t,
      days_early_late: newDel,
      days_to_pay: t.days_to_pay + shift,
      on_time: newDel <= 0,
    };
  });
  const adjustedAll = [...adjustedEarly, ...lateHalf];

  // Verify against the REAL skill before emitting any SQL for this customer.
  const result = analysePaymentBehaviour(adjustedAll.map(t => ({
    payment_date: t.payment_date, days_to_pay: t.days_to_pay,
    days_early_late: t.days_early_late, on_time: t.on_time, amount: t.amount,
  })));

  report.push(`${name}: delta ${delta.toFixed(1)} -> shift ${shift}d -> trend=${result.trend}, health=${result.health}, on_time_rate=${result.on_time_rate?.toFixed(2)}`);

  if (result.health === "at_risk") {
    report.push(`  !! STILL at_risk after softening — needs a bigger shift or manual review, no SQL emitted for ${name}`);
    continue;
  }

  sql += `-- ${name}: delta ${delta.toFixed(1)} -> shift ${shift}d -> ${result.trend}/${result.health}\n`;
  for (const t of adjustedEarly) {
    sql += `UPDATE payment_transactions SET days_early_late=${t.days_early_late}, days_to_pay=${t.days_to_pay}, on_time=${sqlBool(t.on_time)} WHERE id='${t.id}';\n`;
  }
  sql += `\n`;
}

sql += `\n-- Re-check: after COMMIT, re-run backfill-payment-health.mjs to refresh customers.payment_*.\n`;
sql += `ROLLBACK;\n`;

writeFileSync(resolve(__dir, "soften_midtier_trend.sql"), sql);

console.log(`Processed ${targets.length} mid-tier at_risk customers:\n`);
console.log(report.join("\n"));
console.log(`\nWrote soften_midtier_trend.sql (dry-run, ROLLBACK).`);
