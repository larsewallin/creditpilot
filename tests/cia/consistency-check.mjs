#!/usr/bin/env node
// CIA consistency checker — repeated-run reliability testing for questions
// flagged with a "consistency_check" entry in questions.json.
//
// Opt-in, not part of the per-commit harness (tests/cia/run.mjs): repeated
// runs cost real time and API spend, so this is for periodic/pre-release
// verification, run by hand.
//
// Usage:
//   node tests/cia/consistency-check.mjs [--runs=N] [--threshold=X] [--id=q1,q3]
//
// Requires: SUPABASE_URL and SUPABASE_ANON_KEY env vars (same as run.mjs).

import { writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ENDPOINT, questions, askQuestion, evaluate } from "./run.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CLI args ───────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  })
);

const DEFAULT_RUNS = args.runs ? parseInt(args.runs, 10) : 8;
const DEFAULT_THRESHOLD = args.threshold ? parseFloat(args.threshold) : 1.0;
const ID_FILTER = args.id ? String(args.id).split(",").map((s) => s.trim()) : null;

// ── Select flagged questions ─────────────────────────────────────────────

let flagged = questions.filter((q) => q.consistency_check);
if (ID_FILTER) {
  flagged = flagged.filter((q) => ID_FILTER.includes(q.id));
}

if (flagged.length === 0) {
  console.log("No questions flagged with \"consistency_check\" (or none match --id filter). Nothing to do.");
  process.exit(0);
}

// ── Run one flagged question N times ─────────────────────────────────────

async function checkQuestion(q) {
  const runs = q.consistency_check.runs ?? DEFAULT_RUNS;
  const threshold = q.consistency_check.min_pass_rate ?? DEFAULT_THRESHOLD;

  const run_details = [];
  let passCount = 0;

  for (let i = 1; i <= runs; i++) {
    try {
      const { json, duration_ms } = await askQuestion(q.question);
      const response = {
        answer: json.answer ?? json.response ?? "",
        sources: json.sources ?? [],
        confidence: json.confidence ?? "",
        confidence_reason: json.confidence_reason ?? "",
      };
      const failures = evaluate(response, q.expected);
      const runPassed = failures.length === 0;
      if (runPassed) passCount++;

      const detail = {
        run: i,
        passed: runPassed,
        failures,
        duration_ms,
        sources_count: response.sources.length,
      };
      // Only keep full answer/sources for failed runs, to keep passing output compact.
      if (!runPassed) {
        detail.answer = response.answer;
        detail.sources = response.sources;
      }
      run_details.push(detail);
    } catch (err) {
      run_details.push({
        run: i,
        passed: false,
        failures: [`request_error: ${err.message}`],
        duration_ms: 0,
        sources_count: 0,
      });
    }
  }

  const pass_rate = passCount / runs;
  return {
    id: q.id,
    question: q.question,
    runs_requested: runs,
    threshold,
    pass_count: passCount,
    pass_rate,
    reliable: pass_rate >= threshold,
    run_details,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\nCIA Consistency Check — ${new Date().toISOString()}`);
console.log(`Endpoint: ${ENDPOINT}`);
console.log(`Flagged questions: ${flagged.length} (${flagged.map((q) => q.id).join(", ")})\n`);

const results = [];
for (const q of flagged) {
  process.stdout.write(`  ${q.id} ... `);
  const result = await checkQuestion(q);
  results.push(result);

  const bar = "=".repeat(result.pass_count) + ".".repeat(result.runs_requested - result.pass_count);
  const pct = (result.pass_rate * 100).toFixed(1);
  const status = result.pass_rate === 1
    ? "✓ RELIABLE"
    : result.reliable
      ? `✓ within threshold (≥${(result.threshold * 100).toFixed(0)}%)`
      : `✗ BELOW THRESHOLD (≥${(result.threshold * 100).toFixed(0)}%)`;
  console.log(`[${bar}] ${result.pass_count}/${result.runs_requested} (${pct}%)   ${status}`);
}

// ── Save results ───────────────────────────────────────────────────────────

const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
const resultsDir = resolve(__dir, "results");
await mkdir(resultsDir, { recursive: true });
const outPath = resolve(resultsDir, `consistency-${timestamp}.json`);
await writeFile(
  outPath,
  JSON.stringify({ timestamp, defaults: { runs: DEFAULT_RUNS, min_pass_rate: DEFAULT_THRESHOLD }, questions: results }, null, 2),
  "utf8"
);

// ── Summary ────────────────────────────────────────────────────────────────

const reliableCount = results.filter((r) => r.reliable).length;

console.log(`\n${"─".repeat(60)}`);
console.log(`Summary: ${reliableCount}/${results.length} questions within their reliability threshold`);
console.log(`Saved:   ${outPath}`);

const anyRunFailures = results.some((r) => r.run_details.some((d) => !d.passed));
if (anyRunFailures) {
  console.log("\nRun-level failures:");
  for (const r of results) {
    for (const d of r.run_details) {
      if (!d.passed) {
        console.log(`\n  [${r.id}] run ${d.run}/${r.runs_requested} (${d.duration_ms}ms)`);
        for (const f of d.failures) {
          console.log(`    • ${f}`);
        }
        if (d.answer) {
          const truncated = d.answer.length > 300 ? d.answer.slice(0, 300) + "..." : d.answer;
          console.log(`    answer: "${truncated}"`);
          console.log(`    sources: ${d.sources_count}`);
        }
      }
    }
  }
  console.log();
}

if (results.some((r) => !r.reliable)) {
  process.exit(1);
}

console.log();
