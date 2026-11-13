#!/usr/bin/env node
// scripts/changed-since.mjs <base-ref> [head-ref]
//
// Lists what has to ship to production between two commits:
//   migrations  new files in supabase/migrations/ (added, never edited after apply)
//   deploy      edge functions whose own folder, or any _shared file they import
//               (followed through relative imports), changed
//   delete      edge function folders that no longer exist at head
//   config      true when supabase/config.toml changed (verify_jwt etc.)
//
// Prints JSON. Read-only: never touches a database or Supabase.
// Used by .github/workflows/ci.yml (migration dry run on PRs) and deploy.yml.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const [base, head = "HEAD"] = process.argv.slice(2);
if (!base) {
  console.error("Usage: scripts/changed-since.mjs <base-ref> [head-ref]");
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

// name-status with renames: "R100\told\tnew", "A\tpath", "D\tpath", "M\tpath"
const lines = git("diff", "--name-status", "-M", `${base}...${head}`).trim().split("\n").filter(Boolean);
const changed = new Set();
const added = [];
const removed = [];
for (const line of lines) {
  const [status, a, b] = line.split("\t");
  if (status.startsWith("R") || status.startsWith("C")) {
    changed.add(a); changed.add(b); removed.push(a); added.push(b);
  } else {
    changed.add(a);
    if (status === "A") added.push(a);
    if (status === "D") removed.push(a);
  }
}

const FN_DIR = "supabase/functions";
const functionsAtHead = readdirSync(FN_DIR).filter(
  (d) => d !== "_shared" && statSync(join(FN_DIR, d)).isDirectory() && existsSync(join(FN_DIR, d, "index.ts")),
);

// Every file a function reaches through relative imports (static and dynamic).
function reach(entry) {
  const seen = new Set();
  const stack = [entry];
  const re = /(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      const target = normalize(join(dirname(file), m[1] || m[2]));
      stack.push(target);
    }
  }
  return [...seen].map((f) => relative(".", f));
}

// config.toml: a function whose own [functions.<name>] block changed must be
// redeployed for the new setting (e.g. verify_jwt) to take effect.
function configBlocks(ref) {
  let text = "";
  try { text = git("show", `${ref}:supabase/config.toml`); } catch { return {}; }
  const blocks = {};
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\[functions\.([^\]]+)\]\s*$/);
    if (m) { current = m[1]; blocks[current] = ""; continue; }
    if (/^\[/.test(line)) { current = null; continue; }
    if (current && line.trim() && !line.trim().startsWith("#")) blocks[current] += line.trim() + "\n";
  }
  return blocks;
}
const configChanged = new Set();
if (changed.has("supabase/config.toml")) {
  const before = configBlocks(base);
  const after = configBlocks(head);
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name] !== after[name]) configChanged.add(name);
  }
}

const deploy = functionsAtHead.filter((fn) => {
  if (configChanged.has(fn)) return true;
  const files = new Set([...reach(join(FN_DIR, fn, "index.ts"))]);
  for (const c of changed) {
    if (c.startsWith(`${FN_DIR}/${fn}/`)) return true;
    if (files.has(c)) return true;
  }
  return false;
}).sort();

const del = [...new Set(
  removed
    .filter((p) => p.startsWith(`${FN_DIR}/`) && !p.startsWith(`${FN_DIR}/_shared/`))
    .map((p) => p.split("/")[2])
    .filter((fn) => !functionsAtHead.includes(fn)),
)].sort();

const migrations = added
  .filter((p) => /^supabase\/migrations\/[^/]+\.sql$/.test(p) && existsSync(p))
  .sort();

const editedMigrations = [...changed].filter(
  (p) => /^supabase\/migrations\/[^/]+\.sql$/.test(p) && !added.includes(p) && !removed.includes(p),
);

console.log(JSON.stringify({
  base, head,
  migrations,
  editedMigrations,
  deploy,
  delete: del,
  config: changed.has("supabase/config.toml"),
}, null, 2));
