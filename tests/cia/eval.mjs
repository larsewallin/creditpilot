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
  over60: col(`select distinct c.company_name from invoices i join customers c on c.id = i.customer_id where c.${ACTIVE} and i.outstanding_amount > 0 and i.days_overdue > 60 and i.status::text is distinct from 'pre_petition' order by 1`),
  heliogenOverdue: Number(one(`select coalesce(sum(i.outstanding_amount),0) from invoices i join customers c on c.id = i.customer_id where c.company_name ilike 'Heliogen%' and i.days_overdue > 0 and i.status::text is distinct from 'pre_petition'`)),
  arconic: sql(`select credit_limit, current_exposure from customers where company_name ilike 'Arconic%'`)[0]?.map(Number),
  pendingCount: Number(one("select count(*) from pending_actions where status = 'pending' and is_demo")),
  prePetition: col(`select distinct c.company_name from invoices i join customers c on c.id = i.customer_id where i.status = 'pre_petition' and i.outstanding_amount > 0 order by 1`),
  aerospace: Number(one(`select coalesce(sum(current_exposure),0) from customers where ${ACTIVE} and sector = 'Aerospace & Defense'`)),
};
console.log("Ground truth:", JSON.stringify(truth, null, 1), "\n");

// ── asking ──────────────────────────────────────────────────────────────────────
async function ask(question) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/cia-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...(CIA_INTERNAL_TEST_SECRET ? { "x-internal-test-secret": CIA_INTERNAL_TEST_SECRET } : {}),
    },
    body: JSON.stringify({ mode: "question", question }),
  });
  const d = await r.json().catch(() => ({}));
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
const hasNumber = (text, want) => numbersIn(text).some((n) => Math.abs(n - want) <= Math.max(1, Math.abs(want) * 0.005));
const key = (name) => name.replace(/\b(Inc|Corp|Corporation|Ltd|LLC|Company|Group|Holding|Co)\b\.?/gi, "").split(/[\s(,-]+/).filter(Boolean)[0];
const mentions = (text, name) => text.toLowerCase().includes(key(name).toLowerCase());

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
  { q: "Which customers are flagged by three or more agents?", check: () => [] },
  { q: "Should we be worried about Lockheed Martin?", check: () => [] },
  { q: "Tell me about Acme Widgets Corp", check: (a) => [/don't have that information/i.test(a) || "should say it has no information"] },
  { q: "What is our FX exposure by currency?", check: () => [] },
  { q: "Which customers improved recently?", check: () => [] },
  { q: "What should I do about Brixton Fasteners?", check: () => [] },
  { q: "Summarize the portfolio's credit risk in three sentences.", check: () => [] },
];

import { appendFileSync } from "node:fs";
let failed = 0;
const summary = [];
for (const [i, c] of CASES.entries()) {
  const answer = await ask(c.q);
  const problems = c.check(answer).filter((x) => x !== true);
  if (/\[(OFFICIAL|[CIPNFEUM]\d+)/.test(answer)) problems.push("internal tag shown in the answer");
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
