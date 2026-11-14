/**
 * Credit Rating Change Monitor Agent — supabase/functions/credit-rating-agent/index.ts
 *
 * Pure signal agent — emits credit_events via publishEvent only. Does NOT write
 * pending_actions: CIA is the sole owner of credit-limit decisioning and already
 * derives a synthetic CREDIT_RATING_DOWNGRADE (-10pp composite-risk threshold) from the
 * same customers columns. This agent makes that signal visible and auditable as a real
 * event on the Credit Events feed.
 *
 * Logic, per customer with current_exposure > 0 and both credit_rating_score and
 * credit_rating_previous_score set: detectRatingChange(previous, current)
 * (see skills/analytical/detect-rating-change.ts for thresholds). Changes under 5 points
 * emit nothing. Upgrades are severity info.
 *
 * Score feed: in production, step 0 re-scores active customers from Keen when Keen may
 * replace their score (Settings › Credit score source) and they are due (monthly, or a 10-K
 * filed since the last check; skills/analytical/score-refresh.ts). Demo customers keep their
 * seeded scores, so the demo's events and actions never shift.
 *
 * Accounts age (both modes): customers whose financial year end is older than their score
 * allows (Settings › How old accounts may be) get one FINANCIALS_STALE event per year end,
 * published with cia_processed = true (a prompt for the credit team, not a decisioning signal).
 *
 * Idempotency: one event per rating change. A change is "already reported" when this
 * agent has emitted the same event_type for the customer at/after
 * customers.credit_rating_updated_at (or, if that is null, within the last 24h).
 * Live runs also ignore changes older than RECENCY_DAYS. Demo runs self-reset this
 * agent's prior demo events first and skip the recency window (seeded dates age).
 *
 * Request body: { triggered_by?: string }
 * Response:     { run_id: string, status: "completed" }
 *
 * Tables read:  customers, customer_identifiers, credit_applications, sec_filings, company_settings, credit_events (dedup check)
 * Tables written: customers (production re-score), credit_events (via publishEvent), agent_runs
 * Event types emitted: CREDIT_RATING_DOWNGRADE, CREDIT_RATING_UPGRADE, FINANCIALS_STALE
 *
 * Rate limit: 60 minutes between runs (HTTP 429 if exceeded).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { detectRatingChange } from "../_shared/skills/analytical/detect-rating-change.ts";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";
import { keenMayReplace, refreshDue, scoreUpdate, type RefreshCustomer } from "../_shared/skills/analytical/score-refresh.ts";
import { financialsAge } from "../_shared/onboarding/keen_statements.ts";
import { effectiveSettings } from "../_shared/onboarding/settings_validate.ts";
import { liveProviders } from "../_shared/onboarding/live_providers.ts";
import type { CreditApplication, OnboardingSettings } from "../_shared/onboarding/types.ts";

const REFRESH_MAX = 40;        // Keen calls per run; daily runs cover a portfolio within the month
const REFRESH_PARALLEL = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const MAX_CUSTOMERS = 200;
const RECENCY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_TYPES = ["CREDIT_RATING_DOWNGRADE", "CREDIT_RATING_UPGRADE"];

type Db = ReturnType<typeof createClient>;

/** Company settings the agent follows: score order and accounts-age months. */
async function loadSettings(db: Db): Promise<{ order: string[]; financials: OnboardingSettings["financials"] }> {
  const { data } = await db.from("company_settings").select("key, value").in("key", ["onboarding.sources", "onboarding.financials"]);
  const eff = effectiveSettings(Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]))) as Record<string, any>;
  return { order: eff.sources.score_order as string[], financials: eff.financials as OnboardingSettings["financials"] };
}

/**
 * Production step 0: re-score due customers from Keen (10-K by ticker / SEC number, or the
 * statements entered at onboarding). Returns how many were asked and how many changed.
 */
async function refreshFromKeen(db: Db, order: string[], now: Date): Promise<{ asked: number; changed: number; failed: number }> {
  const out = { asked: 0, changed: 0, failed: 0 };
  if (!order.includes("keen")) return out;
  const { data: rows, error } = await db.from("customers")
    .select("id, company_name, country_code, lifecycle_status, current_exposure, credit_rating_score, credit_rating_source, credit_rating_updated_at, credit_rating_checked_at")
    .not("lifecycle_status", "in", "(prospect,declined)")
    .order("credit_rating_checked_at", { ascending: true, nullsFirst: true })
    .limit(500);
  if (error) { console.error("[credit-rating-agent] refresh customers query failed:", error.message); return out; }
  const customers = ((rows ?? []) as (RefreshCustomer & { company_name: string; country_code: string | null })[])
    .filter((c) => keenMayReplace(c.credit_rating_source, order));
  if (!customers.length) return out;
  const ids = customers.map((c) => c.id);

  const [{ data: idRows }, { data: filings }, { data: apps }] = await Promise.all([
    db.from("customer_identifiers").select("customer_id, id_type, id_value").in("customer_id", ids).in("id_type", ["ticker", "cik"]),
    db.from("sec_filings").select("customer_id, filing_date").in("customer_id", ids).eq("filing_type", "10-K").eq("is_demo", false).order("filing_date", { ascending: false }),
    db.from("credit_applications").select("customer_id, answers, updated_at").in("customer_id", ids).eq("status", "decided").order("updated_at", { ascending: false }),
  ]);
  const ident = new Map<string, { ticker?: string; cik?: string }>();
  for (const r of (idRows ?? []) as { customer_id: string; id_type: string; id_value: string }[]) {
    const x = ident.get(r.customer_id) ?? {};
    if (r.id_type === "ticker" && !x.ticker) x.ticker = r.id_value;
    if (r.id_type === "cik" && !x.cik) x.cik = r.id_value;
    ident.set(r.customer_id, x);
  }
  const last10k = new Map<string, string>();
  for (const f of (filings ?? []) as { customer_id: string; filing_date: string }[]) if (!last10k.has(f.customer_id)) last10k.set(f.customer_id, f.filing_date);
  const statements = new Map<string, unknown>();
  for (const a of (apps ?? []) as { customer_id: string; answers: Record<string, unknown> }[]) {
    if (!statements.has(a.customer_id) && a.answers?.keen_statements) statements.set(a.customer_id, a.answers.keen_statements);
  }

  const due = customers.filter((c) => (ident.get(c.id)?.ticker || ident.get(c.id)?.cik || statements.has(c.id)) && refreshDue(c, now, last10k.get(c.id)))
    .slice(0, REFRESH_MAX);
  const providers = liveProviders({ db: db as never, env: (k) => Deno.env.get(k) });

  for (let i = 0; i < due.length; i += REFRESH_PARALLEL) {
    await Promise.all(due.slice(i, i + REFRESH_PARALLEL).map(async (c) => {
      const id = ident.get(c.id) ?? {};
      const app = {
        application_id: `rescore-${c.id}`, submitted_by: "credit_team", legal_name: (c as { company_name: string }).company_name,
        country_code: (c as { country_code: string | null }).country_code ?? undefined, is_public: !!(id.ticker || id.cik),
        ticker: id.ticker, cik: id.cik, keen_statements: id.ticker || id.cik ? undefined : statements.get(c.id),
        people: [], credit_request: {}, trade_references: [], financial_statements: [], signatures: {},
      } as unknown as CreditApplication;
      out.asked++;
      const r = await providers.keenScore(app, []);
      if ("error" in r) {
        out.failed++;
        // Record the check so a company Keen cannot score is asked again next month, not every day.
        if (r.error === "insufficient_data") await db.from("customers").update({ credit_rating_checked_at: now.toISOString() }).eq("id", c.id);
        return;
      }
      const upd = scoreUpdate(c, { score: r.score, label: r.keen?.label, as_of: r.keen?.as_of, from: id.ticker || id.cik ? "sec_10k" : "statements" }, now);
      if ("credit_rating_score" in upd) out.changed++;
      const { error: uErr } = await db.from("customers").update(upd).eq("id", c.id);
      if (uErr) { out.failed++; console.error(`[credit-rating-agent] update failed for ${c.id}:`, uErr.message); }
    }));
  }
  return out;
}

/** Accounts older than the score allows: one FINANCIALS_STALE per customer and year end. */
async function staleFinancials(db: Db, financials: OnboardingSettings["financials"], now: Date, run_id: string, demo: boolean): Promise<number> {
  const { data: rows, error } = await db.from("customers")
    .select("id, company_name, financials_fye, credit_rating_score, credit_rating_source")
    .not("financials_fye", "is", null)
    .not("lifecycle_status", "in", "(prospect,declined)")
    .limit(1000);
  if (error) { console.error("[credit-rating-agent] accounts-age query failed:", error.message); return 0; }
  const stale = ((rows ?? []) as { id: string; company_name: string; financials_fye: string; credit_rating_score: number | null; credit_rating_source: string | null }[])
    .map((c) => ({ c, age: financialsAge(c.financials_fye, now.toISOString(), c.credit_rating_score ?? undefined, financials) }))
    .filter((x) => x.age?.status === "stale");
  if (!stale.length) return 0;
  const { data: prior } = await db.from("credit_events").select("customer_id, payload")
    .eq("event_type", "FINANCIALS_STALE").eq("is_demo", demo).in("customer_id", stale.map((x) => x.c.id));
  const reported = new Set(((prior ?? []) as { customer_id: string; payload: { fye?: string } }[]).map((e) => `${e.customer_id}:${e.payload?.fye}`));
  let n = 0;
  for (const { c, age } of stale) {
    if (!age || reported.has(`${c.id}:${age.fye}`)) continue;
    const summary = `${c.company_name}: accounts for the year ended ${age.fye} are ${age.months} months old; at a score of ${c.credit_rating_score ?? "none"} newer accounts are needed after ${age.max_months} months. Ask the customer for newer${age.max_months <= 9 ? " (half-year or quarterly)" : ""} accounts.`;
    try {
      await publishEvent({
        event_type: "FINANCIALS_STALE", severity: "low", scope: "customer", customer_id: c.id, source_agent: "credit_rating_agent", run_id,
        title: `${c.company_name}: financials out of date (${age.months} months)`, description: summary, summary,
        payload: { severity_score: severityToScore("low"), fye: age.fye, months_old: age.months, max_months: age.max_months,
          score: c.credit_rating_score, score_source: c.credit_rating_source, summary },
        is_demo: demo, cia_processed: true,
      });
      n++;
    } catch (err) { console.error(`[credit-rating-agent] FINANCIALS_STALE failed for ${c.company_name}:`, (err as Error).message); }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "credit_rating_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  // --- Rate limit check ---
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns, error: recentRunsError } = await supabase
    .from("agent_runs")
    .select("id, started_at, status")
    .eq("agent_name", agent_name)
    .gte("started_at", cutoff)
    .in("status", ["completed", "running"])
    .limit(1);
  if (recentRunsError) console.error("[credit-rating-agent] agent_runs query failed:", recentRunsError.message);

  if (recentRuns && recentRuns.length > 0) {
    return new Response(JSON.stringify({
      error: "rate_limited",
      message: "This agent was run recently. Please wait before running again.",
      last_run_at: recentRuns[0].started_at,
    }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const run_id = crypto.randomUUID();
  await supabase.from("agent_runs").insert({
    id: run_id,
    agent_name,
    status: "running",
    started_at: new Date().toISOString(),
    triggered_by,
  });

  // Demo repeatability: clear this agent's prior demo events. Production never self-deletes.
  if (DEMO_MODE) {
    const { error: resetError } = await supabase
      .from("credit_events")
      .delete()
      .eq("source_agent", agent_name)
      .eq("is_demo", true);
    if (resetError) console.error("[credit-rating-agent] demo reset failed:", JSON.stringify(resetError));
  }

  try {
    const now = new Date();
    const settings = await loadSettings(supabase);

    // 0. Production only: re-score due customers from Keen. The demo keeps its seeded scores.
    const refresh = DEMO_MODE ? { asked: 0, changed: 0, failed: 0 } : await refreshFromKeen(supabase, settings.order, now);

    // 1. Candidate customers: positive exposure with a score pair.
    const { data: customers, error: customersError } = await supabase
      .from("customers")
      .select("id, company_name, current_exposure, credit_rating_score, credit_rating_previous_score, credit_rating_raw, credit_rating_source, credit_rating_updated_at")
      .gt("current_exposure", 0)
      .not("credit_rating_score", "is", null)
      .not("credit_rating_previous_score", "is", null)
      .order("current_exposure", { ascending: false })
      .limit(MAX_CUSTOMERS);
    if (customersError) {
      console.error("[credit-rating-agent] customers query failed:", JSON.stringify(customersError));
      throw customersError;
    }
    const scanned = customers?.length ?? 0;

    // 2. Latest emission per (customer, type) for dedup, one batched query.
    const lookback = new Date(now.getTime() - 2 * RECENCY_DAYS * MS_PER_DAY).toISOString();
    const { data: prior, error: priorError } = await supabase
      .from("credit_events")
      .select("customer_id, event_type, created_at")
      .eq("source_agent", agent_name)
      .eq("is_demo", DEMO_MODE)
      .in("event_type", EVENT_TYPES)
      .gte("created_at", lookback);
    if (priorError) console.error("[credit-rating-agent] dedup pre-fetch failed:", JSON.stringify(priorError));
    const lastEmitted = new Map<string, number>();
    for (const e of (prior ?? []) as any[]) {
      const k = `${e.customer_id}:${e.event_type}`;
      const t = new Date(e.created_at).getTime();
      if (t > (lastEmitted.get(k) ?? 0)) lastEmitted.set(k, t);
    }

    let conditionsFound = 0;

    // 3. Evaluate each customer.
    for (const c of (customers ?? []) as any[]) {
      const change = detectRatingChange(Number(c.credit_rating_previous_score), Number(c.credit_rating_score));
      if (!change.type || !change.severity) continue;

      const updatedAt = c.credit_rating_updated_at ? new Date(c.credit_rating_updated_at).getTime() : null;
      if (!DEMO_MODE && updatedAt !== null && now.getTime() - updatedAt > RECENCY_DAYS * MS_PER_DAY) continue;

      const changeSince = updatedAt ?? now.getTime() - MS_PER_DAY;
      const last = lastEmitted.get(`${c.id}:${change.type}`);
      if (last !== undefined && last >= changeSince) continue;

      const absDelta = Math.abs(change.delta);
      const direction = change.type === "CREDIT_RATING_DOWNGRADE" ? "downgraded" : "upgraded";
      const ratingText = c.credit_rating_raw ? ` (now ${c.credit_rating_raw})` : "";
      const summary = `${c.company_name}: credit rating ${direction}${ratingText} — score ${change.previous_score} → ${change.current_score} (${change.delta > 0 ? "+" : ""}${change.delta} pts).` +
        (change.action_required ? " Review of the credit limit is recommended." : "");

      try {
        await publishEvent({
          event_type:   change.type,
          severity:     change.severity,
          scope:        "customer",
          customer_id:  c.id,
          source_agent: agent_name,
          run_id,
          title:        `${c.company_name}: Credit rating ${direction} (${absDelta} pts)`,
          description:  summary,
          summary,
          payload: {
            severity_score:  severityToScore(change.severity),
            previous_score:  change.previous_score,
            current_score:   change.current_score,
            delta:           change.delta,
            action_required: change.action_required,
            current_rating:  c.credit_rating_raw ?? null,
            rating_source:   c.credit_rating_source ?? null,
            summary,
          },
          is_demo: DEMO_MODE,
        });
        conditionsFound++;
      } catch (err) {
        console.error(`[credit-rating-agent] ${change.type} publishEvent failed for ${c.company_name}:`, (err as Error).message);
      }
    }

    // 4. Accounts older than the score allows.
    const staleCount = await staleFinancials(supabase, settings.financials, now, run_id, DEMO_MODE);
    conditionsFound += staleCount;

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned,
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `${DEMO_MODE ? "" : `Re-scored from Keen: ${refresh.asked} asked, ${refresh.changed} changed, ${refresh.failed} without a score. `}Scanned ${scanned} customers with a rating score pair. Emitted ${conditionsFound - staleCount} rating-change events and ${staleCount} financials-out-of-date events.`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ run_id, status: "completed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await supabase.from("agent_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      summary: `Error: ${(err as Error).message}`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
