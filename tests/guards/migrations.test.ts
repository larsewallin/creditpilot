/**
 * Schema guards over supabase/migrations, run with the unit tests. Each catches a mistake
 * that once reached production (2026-11-21):
 *  1. `ADD COLUMN IF NOT EXISTS` on a column an earlier migration already created is skipped
 *     silently, and code then reuses a column that means something else (#89's
 *     pending_actions.recommended_value).
 *  2. A function moved to another schema (`ALTER FUNCTION public.f() SET SCHEMA private`) and
 *     still called by its old name in a later migration or demo script (is_public_demo).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "");

// The baseline (00000000000000) is a snapshot that already holds every column the older
// migrations add again on purpose (idempotent IF NOT EXISTS re-runs), so the check applies to
// migrations written after it: from November 2026 on.
const CHECK_FROM = "20261101";
// Known and documented: 20261122000000 kept a no-op line; 20261122010000 explains it.
const ALLOWED_EXISTING = new Set(["20261122000000_approval_authority.sql:pending_actions.recommended_value"]);

describe("migrations", () => {
  it("never 'add if not exists' a column an earlier migration already created", () => {
    const cols = new Map<string, Set<string>>();
    const add = (t: string, c: string) => (cols.get(t) ?? cols.set(t, new Set()).get(t)!).add(c);
    const problems: string[] = [];
    for (const f of files) {
      const sql = strip(readFileSync(join(DIR, f), "utf8"));
      for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi)) {
        for (const line of m[2].split("\n")) {
          const c = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i)?.[1];
          if (c && !/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)$/i.test(c)) add(m[1].toLowerCase(), c.toLowerCase());
        }
      }
      for (const stmt of sql.split(";")) {
        const t = stmt.match(/ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(?:public\.)?"?(\w+)"?/i)?.[1]?.toLowerCase();
        if (!t) continue;
        for (const a of stmt.matchAll(/ADD COLUMN (IF NOT EXISTS )?"?(\w+)"?/gi)) {
          const c = a[2].toLowerCase();
          if (a[1] && f >= CHECK_FROM && cols.get(t)?.has(c) && !ALLOWED_EXISTING.has(`${f}:${t}.${c}`)) problems.push(`${f}: ${t}.${c} already exists (added earlier), so this ADD is skipped`);
          add(t, c);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("never call a function by a schema it was moved out of", () => {
    const moved: { fn: string; from: string; at: string }[] = [];
    const problems: string[] = [];
    const scripts = readdirSync("scripts").filter((f) => f.endsWith(".sql")).map((f) => ({ f: `scripts/${f}`, sql: strip(readFileSync(join("scripts", f), "utf8")) }));
    for (const f of files) {
      const sql = strip(readFileSync(join(DIR, f), "utf8"));
      for (const mv of moved) if (new RegExp(`\\b${mv.from}\\.${mv.fn}\\s*\\(`, "i").test(sql) && !/CREATE (OR REPLACE )?FUNCTION/i.test(sql)) problems.push(`${f} calls ${mv.from}.${mv.fn}(), moved in ${mv.at}`);
      for (const m of sql.matchAll(/ALTER FUNCTION (\w+)\.(\w+)\([^)]*\) SET SCHEMA (\w+)/gi)) moved.push({ fn: m[2], from: m[1], at: f });
    }
    for (const s of scripts) for (const mv of moved) if (new RegExp(`\\b${mv.from}\\.${mv.fn}\\s*\\(`, "i").test(s.sql)) problems.push(`${s.f} calls ${mv.from}.${mv.fn}(), moved in ${mv.at}`);
    expect(problems).toEqual([]);
  });
});
