#!/usr/bin/env node
// CIA result diff tool
// Usage: node tests/cia/diff.mjs <baseline.json> <new.json>

import { readFile } from "fs/promises";

const [,, baselinePath, newPath] = process.argv;

if (!baselinePath || !newPath) {
  console.error("Usage: node tests/cia/diff.mjs <baseline.json> <new.json>");
  process.exit(1);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const updated  = JSON.parse(await readFile(newPath, "utf8"));

// Index by question id
const baseMap = Object.fromEntries(baseline.results.map(r => [r.id, r]));
const newMap  = Object.fromEntries(updated.results.map(r => [r.id, r]));

const allIds = [...new Set([
  ...baseline.results.map(r => r.id),
  ...updated.results.map(r => r.id),
])];

// ── Unified text diff (line-level) ─────────────────────────────────────────

function lineDiff(a, b) {
  const aLines = (a ?? "").split(/\n/);
  const bLines = (b ?? "").split(/\n/);
  const out = [];

  // Naive LCS diff (sufficient for short answers)
  const m = aLines.length, n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) {
      out.push(`  ${aLines[i]}`);
      i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      out.push(`+ ${bLines[j]}`);
      j++;
    } else {
      out.push(`- ${aLines[i]}`);
      i++;
    }
  }
  return out;
}

// ── Status label ───────────────────────────────────────────────────────────

function status(b, n) {
  if (!b && n)  return "NEW      ";
  if (b && !n)  return "REMOVED  ";
  if (!b.passed && n.passed)  return "IMPROVED ";
  if (b.passed && !n.passed)  return "REGRESSED";
  if (b.passed && n.passed)   return "PASS     ";
  return "FAIL     ";
}

// ── Print ──────────────────────────────────────────────────────────────────

console.log(`\nCIA Diff`);
console.log(`  baseline : ${baselinePath}  (${baseline.timestamp})`);
console.log(`  new      : ${newPath}  (${updated.timestamp})`);
console.log();

let improved = 0, regressed = 0, unchanged = 0;

for (const id of allIds) {
  const b = baseMap[id];
  const n = newMap[id];
  const st = status(b, n);

  if (st.startsWith("IMPROVED")) improved++;
  else if (st.startsWith("REGRESSED")) regressed++;
  else unchanged++;

  console.log(`${"─".repeat(70)}`);
  console.log(`[${st}] ${id}`);

  // Confidence change
  const bConf = b?.response?.confidence ?? "—";
  const nConf = n?.response?.confidence ?? "—";
  const confArrow = bConf === nConf ? "unchanged" : `${bConf} → ${nConf}`;
  console.log(`  confidence : ${confArrow}`);

  // Sources count change
  const bSrc = b?.response?.sources?.length ?? "—";
  const nSrc = n?.response?.sources?.length ?? "—";
  const srcArrow = bSrc === nSrc ? `${bSrc} (unchanged)` : `${bSrc} → ${nSrc}`;
  console.log(`  sources    : ${srcArrow}`);

  // Failures
  if (n && !n.passed) {
    console.log(`  failures   :`);
    for (const f of n.failures) console.log(`    • ${f}`);
  }

  // Answer diff
  const bAnswer = b?.response?.answer ?? "";
  const nAnswer = n?.response?.answer ?? "";
  if (bAnswer !== nAnswer) {
    console.log(`  answer diff:`);
    const diff = lineDiff(bAnswer, nAnswer);
    const hasChanges = diff.some(l => l.startsWith("+") || l.startsWith("-"));
    if (hasChanges) {
      for (const line of diff) {
        if (line.startsWith("+"))      console.log(`    \x1b[32m${line}\x1b[0m`);
        else if (line.startsWith("-")) console.log(`    \x1b[31m${line}\x1b[0m`);
        // unchanged context lines omitted for brevity
      }
    } else {
      console.log("    (whitespace only)");
    }
  } else {
    console.log(`  answer     : unchanged`);
  }

  console.log();
}

console.log(`${"═".repeat(70)}`);
console.log(`Summary: ${improved} improved, ${regressed} regressed, ${unchanged} unchanged`);
console.log();

process.exit(regressed > 0 ? 1 : 0);
