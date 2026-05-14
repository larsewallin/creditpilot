#!/usr/bin/env node
// CIA regression test runner
// Usage: node tests/cia/run.mjs
// Requires: SUPABASE_URL and SUPABASE_ANON_KEY env vars

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  process.exit(1);
}

const ENDPOINT = `${SUPABASE_URL}/functions/v1/cia-agent`;

// ── Load questions ─────────────────────────────────────────────────────────

const { questions } = JSON.parse(
  await readFile(resolve(__dir, "questions.json"), "utf8")
);

// ── Ask one question ───────────────────────────────────────────────────────

async function askQuestion(question) {
  const start = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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

function evaluate(response, expected) {
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

const results = [];
let passed = 0;
let failed = 0;

console.log(`\nCIA Regression Test — ${new Date().toISOString()}`);
console.log(`Endpoint: ${ENDPOINT}`);
console.log(`Running ${questions.length} questions sequentially...\n`);

for (const q of questions) {
  process.stdout.write(`  ${q.id} ... `);
  let result;

  try {
    const { json, duration_ms } = await askQuestion(q.question);
    const response = {
      answer: json.answer ?? json.response ?? "",
      sources: json.sources ?? [],
      confidence: json.confidence ?? "",
      confidence_reason: json.confidence_reason ?? "",
    };
    const failures = evaluate(response, q.expected);
    const questionPassed = failures.length === 0;

    if (questionPassed) passed++; else failed++;
    console.log(questionPassed ? `PASS (${duration_ms}ms)` : `FAIL (${duration_ms}ms)`);

    result = {
      id: q.id,
      question: q.question,
      passed: questionPassed,
      failures,
      response,
      duration_ms,
    };
  } catch (err) {
    failed++;
    console.log(`ERROR: ${err.message}`);
    result = {
      id: q.id,
      question: q.question,
      passed: false,
      failures: [`request_error: ${err.message}`],
      response: null,
      duration_ms: 0,
    };
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
console.log(`Results: ${passed}/${questions.length} passed, ${failed} failed`);
console.log(`Saved:   ${outPath}`);

if (failed > 0) {
  console.log("\nFailures:");
  for (const r of results) {
    if (!r.passed) {
      console.log(`\n  [${r.id}]`);
      for (const f of r.failures) {
        console.log(`    • ${f}`);
      }
    }
  }
  console.log();
  process.exit(1);
}

console.log();
