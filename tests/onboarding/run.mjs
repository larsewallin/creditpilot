#!/usr/bin/env node
// Golden-prospect harness for New Customer Onboarding.
// Usage: node tests/onboarding/run.mjs
// Offline: no Supabase, no API keys. Must pass 14/14 (with CIA 8/8) before
// committing onboarding code once Phase 1 is complete.

import { spawnSync } from "child_process";
import { readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "../..");
mkdirSync(resolve(__dir, "results"), { recursive: true });
const out = resolve(__dir, "results", "latest.json");

spawnSync("npx", ["vitest", "run", "--config", "tests/onboarding/vitest.config.ts", "--reporter=json", `--outputFile=${out}`],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });

let report;
try { report = JSON.parse(readFileSync(out, "utf8")); }
catch { console.error("Harness did not produce results (see errors above)."); process.exit(1); }

const tests = report.testResults.flatMap((f) => f.assertionResults);
let passed = 0;
for (const t of tests.sort((a, b) => a.title.localeCompare(b.title))) {
  const ok = t.status === "passed";
  if (ok) passed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${t.title}`);
  if (!ok) {
    const msg = (t.failureMessages?.[0] ?? "").split("\n").filter((l) => l.trim() && !l.includes("    at ")).slice(0, 6);
    for (const l of msg) console.log(`        ${l.trim()}`);
  }
}
console.log(`\n${passed}/${tests.length} golden prospects passed`);
process.exit(passed === tests.length && tests.length > 0 ? 0 : 1);
