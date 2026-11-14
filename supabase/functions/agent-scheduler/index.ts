/**
 * agent-scheduler — runs the monitoring agents on each company's schedule
 * (Settings › Agent schedules, company_settings "agents.schedule"; logic in
 * _shared/scheduling/schedule.ts).
 *
 * Called every 15 minutes by pg_cron (migration 20261114000000_agent_scheduler.sql)
 * with x-scheduler-secret, or by a signed-in admin / credit manager for a dry run.
 *
 * Demo (DEMO_MODE=true): starts nothing. The demo's agents run on Reset Demo only, so
 * its seeded scores, events and actions never shift. A dry run still reports what
 * production would start now, which is how the production path is checked on the demo.
 *
 * Production: each tick starts one stage of Reset Demo's pipeline: the monitoring
 * agents that are due; else the Risk agent after new Country / Industry / FX results;
 * else CIA's decisioning after new results. Agents keep their own 60-minute limits.
 * Each start is logged in agent_runs as "scheduler:<agent>".
 *
 * Body: { dry_run?: boolean }
 * Answer: { mode: "demo" | "production", dry_run, now, timezone, due, waiting, started }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { AuthError, requireUser } from "../_shared/auth.ts";
import { AGENTS, dispatchName, plan, SCHEDULE_DEFAULTS, type LastRun, type ScheduleSettings } from "../_shared/scheduling/schedule.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean };
  const secret = Deno.env.get("SCHEDULER_SECRET") ?? "";
  const given = req.headers.get("x-scheduler-secret") ?? "";
  let dryRun = body.dry_run === true;
  if (!sameSecret(given, secret)) {
    // A person may only look, never start agents from here.
    try { await requireUser(req, ["admin", "credit_manager"]); }
    catch (e) { return json({ error: e instanceof AuthError ? e.message : "Unauthorized" }, e instanceof AuthError ? e.status : 401); }
    dryRun = true;
  }

  const url = Deno.env.get("SUPABASE_URL")!, serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Agents are called the way the app calls them (the public anon key), so the function gateway accepts it.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const db = createClient(url, serviceKey);
  const demo = Deno.env.get("DEMO_MODE") === "true";
  const now = new Date();

  const { data: row } = await db.from("company_settings").select("value").eq("key", "agents.schedule").maybeSingle();
  const settings = { ...SCHEDULE_DEFAULTS, ...((row?.value ?? {}) as Partial<ScheduleSettings>) } as ScheduleSettings;

  const names = [...AGENTS.map((a) => a.run_name), ...AGENTS.map((a) => dispatchName(a.key))];
  const { data: runs, error } = await db.from("agent_runs").select("agent_name, started_at, completed_at, status")
    .in("agent_name", names).gte("started_at", new Date(now.getTime() - 15 * 86_400_000).toISOString())
    .order("started_at", { ascending: false }).limit(1000);
  if (error) return json({ error: `agent_runs: ${error.message}` }, 500);
  const last: Record<string, LastRun> = {};
  for (const r of (runs ?? []) as (LastRun & { agent_name: string })[]) if (!last[r.agent_name]) last[r.agent_name] = r;

  const p = plan(settings, last, now);
  const answer = { mode: demo ? "demo" : "production", dry_run: dryRun, now: now.toISOString(), timezone: settings.timezone, due: p.due, waiting: p.waiting, started: [] as string[] };
  if (demo || dryRun || !p.due.length) return json(answer);

  // Start each due agent without waiting for it; log the start first so a slow agent is not started twice.
  await db.from("agent_runs").insert(p.due.map((d) => ({
    agent_name: dispatchName(d.key), status: "completed", started_at: now.toISOString(), completed_at: now.toISOString(),
    triggered_by: "schedule", summary: d.reason,
  })));
  const calls = p.due.map(async (d) => {
    const payload = d.key === "cia_decisioning" ? { skip_briefing: true, triggered_by: "schedule" } : { triggered_by: "schedule" };
    try {
      const r = await fetch(`${url}/functions/v1/${d.fn}`, {
        method: "POST", headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!r.ok && r.status !== 429) console.error(`[agent-scheduler] ${d.fn} answered ${r.status}`);
      await r.body?.cancel();
    } catch (e) { console.error(`[agent-scheduler] ${d.fn} failed:`, e instanceof Error ? e.message : String(e)); }
  });
  const all = Promise.all(calls);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(all);
  else await all;
  answer.started = p.due.map((d) => d.key);
  return json(answer);
});
