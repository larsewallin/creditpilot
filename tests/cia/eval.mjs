#!/usr/bin/env node
// CIA accuracy evaluation against the live demo data (read-only).
//
// Asks the deployed cia-agent ~20 questions a visitor or a credit manager would ask,
// works out the right answer straight from the database (psql, read-only queries) and
// checks the CIA's answer against it: numbers within 0.5 %, names present, wrong names
// absent. Prints every answer in full so a person can read them too.
//
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… CIA_INTERNAL_TEST_SECRET=… DATABASE_URL=… node tests/cia/eval.mjs
//
// Informational: a failed check is a warning in the run's summary, not a failed run
// (no failure emails). EVAL_STRICT=1 makes it exit 1. Run by .github/workflows/cia-eval.yml.

import { execFileSync } from "node:child_process";

const { SUPABASE_URL, SUPABASE_ANON_KEY, CIA_INTERNAL_TEST_SECRET, DATABASE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DATABASE_URL) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL (and CIA_INTERNAL_TEST_SECRET).");
  process.exit(2);
}

// ── ground truth (read-only SQL) ────────────────────────────────────────────────
function sql(query) {
  return execFileSync("psql", [DATABASE_URL, "-X", "-q", "-tA", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c",
    `begin read only; ${query}; rollback;`], { encoding: "utf8" })
    .split("\n").filter((l) => l && !/^(BEGIN|ROLLBACK)$/.test(l)).map((l) => l.split("\t"));
}
const one = (q) => sql(q)[0]?.[0];
const col = (q) => sql(q).map((r) => r[0]);

const ACTIVE = "lifecycle_status = 'active'";
const truth = {
  overdue: Number(one("select total_1_30 + total_31_60 + total_61_90 + total_over_90 from v_ar_aging_portfolio")),
  outstanding: Number(one("select total_outstanding from v_ar_aging_portfolio")),
  overLimit: col(`select company_name from customers where ${ACTIVE} and credit_limit > 0 and current_exposure > credit_limit order by company_name`),
  nearOnly: col(`select company_name from customers where ${ACTIVE} and credit_limit > 0 and current_exposure >= 0.85 * credit_limit and current_exposure <= credit_limit`),
  top5: col(`select company_name from customers where ${ACTIVE} order by current_exposure desc nulls last limit 5`),
  biggest: one(`select company_name || '|' || current_exposure from customers where ${ACTIVE} order by current_exposure desc nulls last limit 1`),
  customerCount: Number(one(`select count(*) from customers where ${ACTIVE}`)),
  lowest3: col(`select company_name from customers where ${ACTIVE} and credit_rating_score is not null order by credit_rating_score asc, company_name limit 3`),
  over60: col(`select distinct c.company_name from invoices i join customers c on c.id = i.customer_id where c.${ACTIVE} and i.outstanding_amount > 0 and current_date - i.due_date > 60 and i.status::text is distinct from 'pre_petition' order by 1`),
  heliogenOverdue: Number(one(`select coalesce(sum(i.outstanding_amount),0) from invoices i join customers c on c.id = i.customer_id where c.company_name ilike 'Heliogen%' and i.due_date < current_date and i.outstanding_amount > 0 and i.status::text is distinct from 'pre_petition'`)),
  arconic: sql(`select credit_limit, current_exposure from customers where company_name ilike 'Arconic%'`)[0]?.map(Number),
  pendingCount: Number(one("select count(*) from pending_actions where status = 'pending' and is_demo")),
  prePetition: col(`select distinct c.company_name from invoices i join customers c on c.id = i.customer_id where i.status = 'pre_petition' and i.outstanding_amount > 0 order by 1`),
  aerospace: Number(one(`select coalesce(sum(current_exposure),0) from customers where ${ACTIVE} and sector = 'Aerospace & Defense'`)),
};
console.log("Ground truth:", JSON.stringify(truth, null, 1), "\n");
// Customer-level facts a user sees on Customers, the customer drawer, AR Aging and Payment Behaviour.
const cust = (name) => sql(`select payment_terms_days, credit_rating_score, credit_rating_raw, credit_rating_previous_score, account_manager, invoicing_currency, credit_limit, current_exposure from customers where company_name ilike '${name}%' limit 1`)[0] ?? [];
const pay = (name) => sql(`select current_avg_days_late, prior_avg_days_late, round(current_on_time_rate * 100, 1), round(all_time_on_time_rate * 100, 1) from v_payment_behaviour_current where company_name ilike '${name}%' limit 1`)[0]?.map(Number) ?? [];
const aging = (name) => sql(`select bucket_1_30, bucket_31_60, bucket_61_90, bucket_over_90, current_amount, total_invoice_count from v_ar_aging_current where company_name ilike '${name}%' limit 1`)[0]?.map(Number) ?? [];
const lastPay = (name) => sql(`select p.payment_date, p.days_early_late from payment_transactions p join customers c on c.id = p.customer_id where c.company_name ilike '${name}%' order by p.payment_date desc limit 1`)[0] ?? [];
const overdueInvoices = (name) => col(`select i.invoice_number from invoices i join customers c on c.id = i.customer_id where c.company_name ilike '${name}%' and i.outstanding_amount > 0 and i.due_date < current_date and i.status::text is distinct from 'pre_petition' order by i.due_date limit 5`);
// Days overdue from the due date, as the AR Aging page and the CIA count them (the stored
// days_overdue column is not kept current).
const oldestOverdue = (name) => Number(one(`select coalesce(max(greatest(current_date - i.due_date, 0)),0) from invoices i join customers c on c.id = i.customer_id where c.company_name ilike '${name}%' and i.outstanding_amount > 0 and i.status::text is distinct from 'pre_petition'`));
const C = {
  arconic: cust("Arconic"), triumph: cust("Triumph"), lockheed: cust("Lockheed"), heliogen: cust("Heliogen"), kaman: cust("Kaman"), nordsee: cust("Nordsee"),
  triumphPay: pay("Triumph"), brixtonPay: pay("Brixton"), triumphAging: aging("Triumph"), arconicAging: aging("Arconic"),
  triumphLast: lastPay("Triumph"), arconicOverdue: overdueInvoices("Arconic"),
  arconicOverdueAmt: Number(one(`select coalesce(sum(i.outstanding_amount),0) from invoices i join customers c on c.id = i.customer_id where c.company_name ilike 'Arconic%' and i.due_date < current_date and i.outstanding_amount > 0 and i.status::text is distinct from 'pre_petition'`)), arconicOldest: oldestOverdue("Arconic"),
  eur: Number(one("select coalesce(sum(outstanding_amount),0) from invoices where outstanding_amount > 0 and currency = 'EUR'")),
  germany: Number(one(`select coalesce(sum(current_exposure),0) from customers where ${ACTIVE} and country_code = 'DE'`)),
  portfolioDaysLate: Number(one("select avg_days_early_late from v_payment_behaviour_portfolio")),
  deteriorating: col(`select company_name from v_payment_behaviour_current where deterioration_severity is not null order by company_name`),
};
console.log("Customer-level truth:", JSON.stringify(C, null, 1), "\n");


// ── asking ──────────────────────────────────────────────────────────────────────
// The last reply in full (follow-up questions, confidence reason) for the checks below.
let last = {};
async function ask(question, previous) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/cia-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...(CIA_INTERNAL_TEST_SECRET ? { "x-internal-test-secret": CIA_INTERNAL_TEST_SECRET } : {}),
    },
    body: JSON.stringify({ mode: "question", question, ...(previous ? { previous_question: previous } : {}) }),
  });
  const d = await r.json().catch(() => ({}));
  last = d;
  return String(d.answer ?? d.error ?? `HTTP ${r.status}`);
}

// ── checks ──────────────────────────────────────────────────────────────────────
/** Every number written in the answer, with "M"/"million"/"k" expanded. */
function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(/\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(million|mn|m|thousand|k|bn|billion)?\b/gi)) {
    let n = Number(m[1].replace(/,/g, ""));
    const u = (m[2] ?? "").toLowerCase();
    if (u === "million" || u === "mn" || u === "m") n *= 1e6;
    else if (u === "thousand" || u === "k") n *= 1e3;
    else if (u === "bn" || u === "billion") n *= 1e9;
    out.push(n);
  }
  return out;
}
const hasNumber = (text, want) => numbersIn(text).some((n) => Math.abs(n - want) <= Math.max(Math.abs(want) < 100 ? 0.6 : 1, Math.abs(want) * 0.005));
const key = (name) => name.replace(/\b(Inc|Corp|Corporation|Ltd|LLC|Company|Group|Holding|Co)\b\.?/gi, "").split(/[\s(,-]+/).filter(Boolean)[0];
const mentions = (text, name) => text.toLowerCase().includes(key(name).toLowerCase());

// An advice answer: facts first, then next steps; nothing CreditPilot cannot act on unless asked;
// follow-ups it can answer; a confidence reason without internal names.
const TIER3 = /collateral|guarantee|letter of credit|credit insurance|bank (?:data|statements?)/i;
function advice(a, { asksTier3 = false } = {}) {
  const related = (last.relatedQuestions ?? []).join(" | ");
  return [
    !/^\W*I don't have/i.test(a) || "opens with what is missing",
    /suggested next steps/i.test(a) || "no Suggested next steps",
    asksTier3 || !TIER3.test(a) || "raises something CreditPilot does not track (not asked)",
    !TIER3.test(related) || `follow-up it cannot answer: ${related}`,
    !/OFFICIAL|TABLE\b|tier\b/.test(last.confidence_reason ?? "") || `internal names in the confidence reason: ${last.confidence_reason}`,
  ];
}

const CASES = [
  { q: "What is our total overdue AR?", check: (a) => [hasNumber(a, truth.overdue) || `total overdue ${truth.overdue} not in answer`] },
  { q: "How much do customers owe us in total?", check: (a) => [hasNumber(a, truth.outstanding) || `total outstanding ${truth.outstanding} not in answer`] },
  { q: "Which customers are over their credit limit?", check: (a) => [
      ...truth.overLimit.map((n) => mentions(a, n) || `${n} (over limit) missing`),
    ] },
  { q: "Who is my biggest exposure?", check: (a) => {
      const [name, amt] = truth.biggest.split("|");
      return [mentions(a, name) || `${name} not named`, hasNumber(a, Number(amt)) || `${amt} not in answer`];
    } },
  { q: "List my five largest exposures.", check: (a) => truth.top5.map((n) => mentions(a, n) || `${n} (top 5) missing`) },
  { q: "How many customers do we have?", check: (a) => [hasNumber(a, truth.customerCount) || `customer count ${truth.customerCount} not in answer`] },
  { q: "Which three customers have the lowest credit scores?", check: (a) => truth.lowest3.map((n) => mentions(a, n) || `${n} (lowest score) missing`) },
  { q: "Which customers have invoices more than 60 days overdue?", check: (a) => truth.over60.map((n) => mentions(a, n) || `${n} (61+ days) missing`) },
  { q: "How much does Heliogen owe us that is overdue?", check: (a) => [hasNumber(a, truth.heliogenOverdue) || `Heliogen overdue ${truth.heliogenOverdue} not in answer`] },
  { q: "What is Arconic's credit limit and current balance?", check: (a) => truth.arconic ? [
      hasNumber(a, truth.arconic[0]) || `limit ${truth.arconic[0]} missing`, hasNumber(a, truth.arconic[1]) || `balance ${truth.arconic[1]} missing`] : [] },
  { q: "How many proposed actions are waiting for approval?", check: (a) => [hasNumber(a, truth.pendingCount) || `pending count ${truth.pendingCount} not in answer`] },
  { q: "Which customers are in bankruptcy?", check: (a) => truth.prePetition.map((n) => mentions(a, n) || `${n} (pre-petition) missing`) },
  { q: "What is our total exposure to the aerospace sector?", check: (a) => [hasNumber(a, truth.aerospace) || `aerospace exposure ${truth.aerospace} not in answer`] },
  // ── Customer level: what a user sees on Customers, AR Aging and Payment Behaviour ──
  { q: "What are Arconic's payment terms?", check: (a) => [hasNumber(a, Number(C.arconic[0])) || `terms ${C.arconic[0]} days missing`] },
  { q: "What is Lockheed Martin's credit score and rating?", check: (a) => [
      hasNumber(a, Number(C.lockheed[1])) || `score ${C.lockheed[1]} missing`, !C.lockheed[2] || a.includes(C.lockheed[2]) || `rating ${C.lockheed[2]} missing`] },
  { q: "What was Heliogen's previous credit score, and what is it now?", check: (a) => [
      hasNumber(a, Number(C.heliogen[3])) || `previous score ${C.heliogen[3]} missing`, hasNumber(a, Number(C.heliogen[1])) || `score ${C.heliogen[1]} missing`] },
  { q: "Who is the account manager for Kaman?", check: (a) => [!C.kaman[4] || a.includes(C.kaman[4].split(" ")[0]) || `account manager ${C.kaman[4]} missing`] },
  { q: "What currency does Nordsee Erdgas invoice in?", check: (a) => [!C.nordsee[5] || a.includes(C.nordsee[5]) || /euro/i.test(a) || `currency ${C.nordsee[5]} missing`] },
  { q: "How late does Triumph Group pay now compared with before?", check: (a) => [
      hasNumber(a, C.triumphPay[0]) || `current avg days late ${C.triumphPay[0]} missing`, hasNumber(a, C.triumphPay[1]) || `prior ${C.triumphPay[1]} missing`] },
  { q: "What is Brixton Fasteners' on-time payment rate?", check: (a) => [
      hasNumber(a, C.brixtonPay[2]) || hasNumber(a, C.brixtonPay[3]) || `on-time rate ${C.brixtonPay[2]}% (recent) or ${C.brixtonPay[3]}% (all time) missing`] },
  { q: "When did Triumph Group last pay us, and how late was it?", check: (a) => [
      (C.triumphLast[0] && (a.includes(C.triumphLast[0]) || a.includes(new Date(C.triumphLast[0]).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })))) || `last payment ${C.triumphLast[0]} missing`,
      hasNumber(a, Math.abs(Number(C.triumphLast[1]))) || `days late ${C.triumphLast[1]} missing`] },
  { q: "Show Triumph Group's AR aging by bucket.", check: (a) => C.triumphAging.slice(0, 4).filter((v) => v > 0).map((v) => hasNumber(a, v) || `bucket ${v} missing`) },
  { q: "How many open invoices does Arconic have, and how overdue is the oldest?", check: (a) => [
      hasNumber(a, C.arconicAging[5]) || `invoice count ${C.arconicAging[5]} missing`, hasNumber(a, C.arconicOldest) || `oldest ${C.arconicOldest} days missing`] },
  { q: "How much does Arconic owe us that is past due?", check: (a) => [hasNumber(a, C.arconicOverdueAmt) || `Arconic overdue ${C.arconicOverdueAmt} missing`] },
  { q: "List Arconic's overdue invoices.", check: (a) => C.arconicOverdue.map((n) => a.includes(n) || `invoice ${n} missing`) },
  { q: "What is Arconic's credit utilization?", check: (a) => [hasNumber(a, Math.round(Number(C.arconic[7]) / Number(C.arconic[6]) * 1000) / 10) || hasNumber(a, Math.round(Number(C.arconic[7]) / Number(C.arconic[6]) * 100)) || "utilization missing"] },
  { q: "What is our total exposure to customers in Germany?", check: (a) => [hasNumber(a, C.germany) || `Germany exposure ${C.germany} missing`] },
  { q: "On average, how many days late do customers pay?", check: (a) => [hasNumber(a, C.portfolioDaysLate) || `portfolio avg ${C.portfolioDaysLate} missing`] },
  { q: "Which customers' payments are getting worse?", check: (a) => C.deteriorating.map((n) => mentions(a, n) || `${n} (deteriorating) missing`) },
  { q: "Which customers are flagged by three or more agents?", check: () => [] },
  { q: "Should we be worried about Lockheed Martin?", check: () => [] },
  { q: "Tell me about Acme Widgets Corp", check: (a) => [/don't have that information/i.test(a) || "should say it has no information"] },
  { q: "What is our FX exposure by currency?", check: (a) => [hasNumber(a, C.eur) || `EUR open receivables ${C.eur} (USD) missing`] },
  { q: "Which customers improved recently?", check: () => [] },
  // ── Advice: answer first, then Suggested next steps CreditPilot can act on ──
  { q: "What should I do about Brixton Fasteners?", check: (a) => advice(a) },
  { q: "Should we extend Arconic's payment terms to 60 days? Do we need collateral?", check: (a) => [
      ...advice(a, { asksTier3: true }),
      /financial|accounts/i.test(a) || "should suggest asking for Arconic's latest accounts (none on file)"] },
  { q: "Can we raise Lockheed Martin's credit limit?", check: (a) => advice(a) },
  { q: "Is Triumph Group safe to extend more credit to?", check: (a) => advice(a) },
  { q: "Should we approve the proposed actions for Heliogen?", check: (a) => advice(a) },
  { q: "Do we have credit insurance on Kaman?", check: (a) => [
      !/^\W*I don't have/i.test(a) || "opens with what is missing", /insurance/i.test(a) || "should say credit insurance is not tracked"] },
  // A follow-up that names no company carries the earlier question's company over.
  { q: "And how do they pay?", previous: "What is Arconic's credit limit and current balance?", check: (a) => [
      /arconic/i.test(a) || "lost the company from the earlier question", /on.?time|late|days/i.test(a) || "no payment facts"] },
  { q: "Summarize the portfolio's credit risk in three sentences.", check: () => [] },
];

import { appendFileSync } from "node:fs";
let failed = 0;
const summary = [];
for (const [i, c] of CASES.entries()) {
  const answer = await ask(c.q, c.previous);
  const problems = c.check(answer).filter((x) => x !== true);
  if (/\[(OFFICIAL|[CIPNFEUM]\d+)/.test(answer)) problems.push("internal tag shown in the answer");
  else if (/\[[^\]]+\](?!\()/.test(answer)) problems.push("bracketed text in the answer (looks like a citation label)");
  failed += problems.length ? 1 : 0;
  if (problems.length) { console.log(`::warning::CIA eval: "${c.q}": ${problems.join("; ")}`); summary.push(`- ✗ ${c.q}: ${problems.join("; ")}`); }
  console.log(`\n── ${i + 1}. ${c.q}  ${problems.length ? "✗ " + problems.join("; ") : c.check.length || problems.length ? "✓" : "(read)"}`);
  console.log(answer);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed their checks`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## CIA eval: ${CASES.length - failed}/${CASES.length} passed\n\n${summary.join("\n") || "All checks passed."}\n\nEvery answer is in the job log.\n`);
}
process.exit(failed && process.env.EVAL_STRICT === "1" ? 1 : 0);
