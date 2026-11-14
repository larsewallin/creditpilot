#!/usr/bin/env node
// CIA regression test runner
// Usage: node tests/cia/run.mjs
// Requires: SUPABASE_URL and SUPABASE_ANON_KEY env vars
// Optional: CIA_INTERNAL_TEST_SECRET (must match the Supabase Edge Function
//   secret of the same name) -- bypasses cia-agent's per-IP daily question
//   rate limit, which this harness's questions per run would otherwise exceed.
//   Without it, the harness runs against the real limit like any visitor.

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CIA_INTERNAL_TEST_SECRET = process.env.CIA_INTERNAL_TEST_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  process.exit(1);
}

export const ENDPOINT = `${SUPABASE_URL}/functions/v1/cia-agent`;

// ── Load questions ─────────────────────────────────────────────────────────

export const { questions } = JSON.parse(
  await readFile(resolve(__dir, "questions.json"), "utf8")
);

// ── Ask one question ───────────────────────────────────────────────────────

export async function askQuestion(question) {
  const start = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...(CIA_INTERNAL_TEST_SECRET ? { "x-internal-test-secret": CIA_INTERNAL_TEST_SECRET } : {}),
    },
    body: JSON.stringify({ mode: "question", question }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();
  const duration_ms = Date.now() - start;
  return { json, duration_ms };
}

// ── Evaluate expectations ──────────────────────────────────────────────────

export function evaluate(response, expected) {
  const failures = [];
  const answer = (response.answer ?? "").toLowerCase();
  const sources = Array.isArray(response.sources) ? response.sources : [];
  const confidence = response.confidence ?? "";

  if (expected.must_mention) {
    for (const term of expected.must_mention) {
      if (!answer.includes(term.toLowerCase())) {
        failures.push(`must_mention: "${term}" not found in answer`);
      }
    }
  }

  if (expected.must_not_say) {
    for (const term of expected.must_not_say) {
      if (answer.includes(term.toLowerCase())) {
        failures.push(`must_not_say: "${term}" found in answer`);
      }
    }
  }

  if (expected.must_say) {
    for (const term of expected.must_say) {
      if (!answer.includes(term.toLowerCase())) {
        failures.push(`must_say: "${term}" not found in answer`);
      }
    }
  }

  if (expected.must_not_mention_inline) {
    for (const term of expected.must_not_mention_inline) {
      if (answer.includes(term.toLowerCase())) {
        failures.push(`must_not_mention_inline: "${term}" found in answer`);
      }
    }
  }

  if (expected.min_sources !== undefined && sources.length < expected.min_sources) {
    failures.push(`min_sources: expected >= ${expected.min_sources}, got ${sources.length}`);
  }

  if (expected.max_sources !== undefined && sources.length > expected.max_sources) {
    failures.push(`max_sources: expected <= ${expected.max_sources}, got ${sources.length}`);
  }

  if (expected.expected_confidence && !expected.expected_confidence.includes(confidence)) {
    failures.push(`expected_confidence: got "${confidence}", allowed ${JSON.stringify(expected.expected_confidence)}`);
  }

  return failures;
}

// ── Main ───────────────────────────────────────────────────────────────────
// Guarded so this file can be imported (e.g. by consistency-check.mjs, which
// reuses askQuestion/evaluate above) without also triggering a full test run
// as a side effect — `node tests/cia/run.mjs` still behaves identically.

if (import.meta.url === `file://${process.argv[1]}`) {

const results = [];
let passed = 0;
let failed = 0;

console.log(`\nCIA Regression Test — ${new Date().toISOString()}`);
console.log(`Endpoint: ${ENDPOINT}`);
// The all-pass commit gate is defined against prod's demo data (2026-10-13: a run
// against staging after switching to it showed 7/8 purely from data differences).
const PROD_REF = "yxqudytimmxufypothis";
if (!SUPABASE_URL.includes(PROD_REF)) {
  console.log("\n⚠️  NOT PROD: this run uses " + SUPABASE_URL + ".");
  console.log("   The commit gate is every question passing against prod. Run via: npm run db:prod -- node tests/cia/run.mjs\n");
}
console.log(`Running ${questions.length} questions sequentially...\n`);

// One attempt at a question: ask, grade, never throw.
async function attempt(q) {
  try {
    const { json, duration_ms } = await askQuestion(q.question);
    const response = {
      answer: json.answer ?? json.response ?? "",
      sources: json.sources ?? [],
      confidence: json.confidence ?? "",
      confidence_reason: json.confidence_reason ?? "",
    };
    const failures = evaluate(response, q.expected);
    return { id: q.id, question: q.question, passed: failures.length === 0, failures, response, duration_ms };
  } catch (err) {
    return { id: q.id, question: q.question, passed: false, failures: [`request_error: ${err.message}`], response: null, duration_ms: 0 };
  }
}

// A failed question is asked once more (CIA_RETRIES, default 1): the answers come from a
// language model, so one run can wobble on a borderline criterion (backlog E11). A real
// regression fails every attempt. A pass on retry is reported, with the first failure kept.
const RETRIES = Math.max(0, Number(process.env.CIA_RETRIES ?? 1));
let passedOnRetry = 0;

for (const q of questions) {
  process.stdout.write(`  ${q.id} ... `);
  let result = await attempt(q);
  const earlier = [];
  for (let i = 0; i < RETRIES && !result.passed; i++) {
    earlier.push({ failures: result.failures, confidence: result.response?.confidence ?? null, confidence_reason: result.response?.confidence_reason ?? null });
    result = await attempt(q);
  }
  if (earlier.length) result.earlier_attempts = earlier;
  if (result.passed) {
    passed++;
    if (earlier.length) passedOnRetry++;
    console.log(earlier.length ? `PASS on retry (${result.duration_ms}ms; first attempt: ${earlier[0].failures.join("; ")})` : `PASS (${result.duration_ms}ms)`);
  } else {
    failed++;
    console.log(result.failures[0]?.startsWith("request_error") ? `ERROR: ${result.failures[0].slice(15)}` : `FAIL (${result.duration_ms}ms)`);
  }
  results.push(result);
}

// ── Write results file ─────────────────────────────────────────────────────

const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
const resultsDir = resolve(__dir, "results");
await mkdir(resultsDir, { recursive: true });
const outPath = resolve(resultsDir, `${timestamp}.json`);
await writeFile(outPath, JSON.stringify({ timestamp, results }, null, 2), "utf8");

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed}/${questions.length} passed, ${failed} failed${passedOnRetry ? ` (${passedOnRetry} passed on retry)` : ""}`);
console.log(`Saved:   ${outPath}`);

if (failed > 0) {
  console.log("\nFailures:");
  for (const r of results) {
    if (!r.passed) {
      console.log(`\n  [${r.id}]`);
      for (const f of r.failures) {
        console.log(`    • ${f}`);
      }
      if (r.response?.confidence_reason) console.log(`    confidence reason: ${r.response.confidence_reason}`);
    }
  }
  console.log();
  process.exit(1);
}

console.log();

}
