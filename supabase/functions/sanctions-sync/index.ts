/**
 * sanctions-sync — refreshes the local copy of the official sanctions lists.
 *
 *   POST {}                      all lists
 *   POST { lists: ["UN","EU"] }  some lists
 *
 * Auth: a signed-in admin, or the scheduler's header x-sync-secret = SANCTIONS_SYNC_SECRET.
 *
 * Per list: log a run → download the official file → parse (sanctions_parsers.ts)
 * → load into sanctions_entries_staging in chunks → fn_sanctions_swap replaces the
 * live list in one transaction (refusing a file that shrank by more than half).
 * Any failure marks the run 'error' and leaves the previous list in place;
 * screening refuses to run once a list is more than 3 days old (fail closed).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { AuthError, requireUser } from "../_shared/auth.ts";
import { PARSERS, SOURCES, type ListName, type ParsedEntry } from "../_shared/onboarding/sanctions_parsers.ts";
import { normalize } from "../_shared/skills/analytical/match-sanctions-name.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const CHUNK = 500;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const secret = Deno.env.get("SANCTIONS_SYNC_SECRET");
    const viaScheduler = !!secret && req.headers.get("x-sync-secret") === secret;
    if (!viaScheduler) await requireUser(req, ["admin"]);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const wanted = (Array.isArray(body?.lists) ? body.lists : Object.keys(SOURCES)) as ListName[];
    const results = [];
    for (const list of wanted) {
      if (!SOURCES[list]) { results.push({ list, status: "error", error: "unknown list" }); continue; }
      results.push(await syncList(db, list));
    }
    return json({ results });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function syncList(db: SupabaseClient, list: ListName) {
  const source = SOURCES[list];
  const { data: run, error: runErr } = await db.from("sanctions_list_runs")
    .insert({ list, source_url: source.urls.join(" ") }).select("id").single();
  if (runErr) return { list, status: "error", error: runErr.message };
  const fail = async (message: string) => {
    await db.from("sanctions_entries_staging").delete().eq("run_id", run.id);
    await db.from("sanctions_list_runs").update({ status: "error", error: message.slice(0, 2000), finished_at: new Date().toISOString() }).eq("id", run.id);
    return { list, status: "error", error: message };
  };
  try {
    const files: string[] = [];
    for (const url of source.urls) {
      const r = await fetch(url, { headers: { "User-Agent": "CreditPilot sanctions-sync (credit-ops@creditpilot.app)" } });
      if (!r.ok) return await fail(`Download failed ${r.status} for ${url}`);
      files.push(await r.text());
    }
    const entries: ParsedEntry[] = PARSERS[list](files);
    if (entries.length < source.min_entries) return await fail(`Parsed only ${entries.length} entries (expected at least ${source.min_entries}); format may have changed`);

    const rows = entries.map((e) => ({
      run_id: run.id, list, list_id: e.list_id, entry_type: e.type, name: e.name, aliases: e.aliases,
      country_code: e.country_code ?? null, date_of_birth: e.date_of_birth ?? null, programs: e.programs ?? [],
      names_norm: [...new Set([e.name, ...e.aliases].map((n) => normalize(n, e.type).join(" ")).filter(Boolean))],
    }));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db.from("sanctions_entries_staging").insert(rows.slice(i, i + CHUNK));
      if (error) return await fail(`Staging insert failed: ${error.message}`);
    }
    const { data: count, error: swapErr } = await db.rpc("fn_sanctions_swap", { p_run_id: run.id });
    if (swapErr) return await fail(swapErr.message);
    return { list, status: "ok", entries: count };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}
