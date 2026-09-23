/**
 * Payment Behaviour Monitor Agent — supabase/functions/payment-behaviour-agent/index.ts
 *
 * Pure signal agent — emits credit_events via publishEvent only. Does NOT touch
 * customers.payment_health / payment_trend / payment_on_time_rate — that write-back
 * stays with ar-aging-agent (analyse-payment-behaviour skill), unchanged.
 *
 * No external API calls: payment_transactions is an internal table, so (unlike
 * sec-monitor-agent/news-monitor-agent) there is no demo-seed vs live-fetch split
 * and no per-run customer cap driven by third-party rate limits. MAX_CUSTOMERS below
 * is a generous safety backstop only, sized comfortably above the real customer count
 * — see the sec-monitor-agent MAX_CUSTOMERS_PER_RUN_LIVE/DEMO history for what happens
 * when a cap meant for a different constraint (external HTTP calls) gets applied
 * uniformly to a cheap indexed-lookup path and silently truncates coverage.
 *
 * Logic, per customer with current_exposure > 0 (see analyse-payment-trend.ts skill
 * for the full window/threshold spec):
 *   - Split payment_transactions into two 30-day windows: current (last 30 days from
 *     now) and prior (the 30 days before that). Skip the customer if either window
 *     has zero qualifying transactions.
 *   - PAYMENT_DETERIORATION: current_avg_days_late − prior_avg_days_late >= 5 AND
 *     current_avg_days_late > 0.
 *   - PAYMENT_IMPROVEMENT: prior_avg_days_late − current_avg_days_late >= 5 AND
 *     prior_avg_days_late > 0.
 *   - PAYMENT_VOLATILITY: population stddev(days_early_late) over the current window
 *     >= 10 — checked independently, so a customer can fire both a trend event and a
 *     volatility event in the same run.
 *
 * Payload note: PaymentDeteriorationPayload/PaymentImprovementPayload's field names
 * (current_avg_days_to_pay / prior_avg_days_to_pay) predate this agent and are a known
 * misnomer — the values are avg(days_early_late), not avg(days_to_pay). Documented as
 * "acceptable today, cosmetic rename when the agent is built" in the deferred backlog;
 * kept as-is here to match the existing Zod schema in event_schemas.ts without a
 * taxonomy_version bump.
 *
 * Idempotency: agent_processed_events is a fully orphaned table (see
 * docs/LEGACY_TABLES.md) — no agent reads or writes it. Every existing agent instead
 * dedups against its own domain table (content_fingerprint on negative_news,
 * accession_number on sec_filings). This agent writes only to credit_events, so it
 * dedups the same way against credit_events itself: fingerprint = customer_id +
 * event_type + today's date (the current window's end date, since the window is
 * anchored on "now"). A same-day re-run won't duplicate; a new day's run fires again
 * if conditions still hold.
 *
 * Request body: { triggered_by?: string }
 * Response:     { run_id: string, status: "completed" }
 *
 * Tables read:  customers, payment_transactions, credit_events (dedup check)
 * Tables written: credit_events (via publishEvent), agent_runs
 * Event types emitted: PAYMENT_DETERIORATION, PAYMENT_IMPROVEMENT, PAYMENT_VOLATILITY
 *
 * Rate limit: 60 minutes between runs (HTTP 429 if exceeded).
 * Demo mode:  reads the same tables as production; DEMO_MODE only self-resets this
 *             agent's prior demo credit_events before each run, matching
 *             ar-aging-agent/sec-monitor-agent.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { analysePaymentTrend, OBSERVATION_WINDOW_DAYS } from "../_shared/skills/analytical/analyse-payment-trend.ts";
import { publishEvent } from "../_shared/publishEvent.ts";
import { severityToScore } from "../_shared/event_schemas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const MAX_CUSTOMERS = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "payment_behaviour_agent";
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
  if (recentRunsError) console.error("[payment-behaviour-agent] agent_runs query failed:", recentRunsError.message);

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

  // Demo repeatability: clear this agent's prior demo events so each demo run
  // reproduces the same output. Gated on DEMO_MODE — production never self-deletes.
  if (DEMO_MODE) {
    const { error: resetError } = await supabase
      .from("credit_events")
      .delete()
      .eq("source_agent", agent_name)
      .eq("is_demo", true);
    if (resetError) {
      console.error("[payment-behaviour-agent] demo reset failed:", JSON.stringify(resetError));
    }
  }

  try {
    const now = new Date();

    // 1. Load candidate customers (current_exposure > 0).
    const { data: customers, error: customersError } = await supabase
      .from("customers")
      .select("id, company_name, current_exposure")
      .gt("current_exposure", 0)
      .order("current_exposure", { ascending: false })
      .limit(MAX_CUSTOMERS);
    if (customersError) {
      console.error("[payment-behaviour-agent] customers query failed:", JSON.stringify(customersError));
      throw customersError;
    }

    const scanned = customers?.length ?? 0;

    // 2. Pre-fetch today's already-emitted (customer_id, event_type) pairs for this
    //    agent, in one batched query, so a same-day re-run doesn't duplicate events.
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data: alreadyEmitted, error: alreadyEmittedError } = await supabase
      .from("credit_events")
      .select("customer_id, event_type")
      .eq("source_agent", agent_name)
      .eq("is_demo", DEMO_MODE)
      .in("event_type", ["PAYMENT_DETERIORATION", "PAYMENT_IMPROVEMENT", "PAYMENT_VOLATILITY"])
      .gte("created_at", todayStart);
    if (alreadyEmittedError) {
      console.error("[payment-behaviour-agent] dedup pre-fetch failed:", JSON.stringify(alreadyEmittedError));
    }
    const emittedToday = new Set(
      (alreadyEmitted ?? []).map((e: any) => `${e.customer_id}:${e.event_type}`)
    );

    let conditionsFound = 0;

    // 3. Evaluate each customer.
    for (const customer of (customers ?? [])) {
      const customerId: string = customer.id;
      const companyName: string = customer.company_name;

      const windowStart = new Date(now.getTime() - 2 * OBSERVATION_WINDOW_DAYS * MS_PER_DAY)
        .toISOString().slice(0, 10);
      const windowEnd = now.toISOString().slice(0, 10);

      const { data: transactions, error: transactionsError } = await supabase
        .from("payment_transactions")
        .select("payment_date, days_early_late")
        .eq("customer_id", customerId)
        .gte("payment_date", windowStart)
        .lte("payment_date", windowEnd)
        .order("payment_date", { ascending: true });
      if (transactionsError) {
        console.error(`[payment-behaviour-agent] payment_transactions query failed for ${companyName}:`, transactionsError.message);
        continue;
      }

      const trend = analysePaymentTrend(transactions ?? [], now);
      if (!trend.has_sufficient_data) continue;

      const swing = trend.current_avg_days_late - trend.prior_avg_days_late;

      // --- PAYMENT_DETERIORATION ---
      if (trend.deterioration && !emittedToday.has(`${customerId}:PAYMENT_DETERIORATION`)) {
        const { severity, trend_direction } = trend.deterioration;
        const summary = `${companyName}: average days late rose from ${trend.prior_avg_days_late} to ${trend.current_avg_days_late} days over the past ${OBSERVATION_WINDOW_DAYS} days (+${swing.toFixed(1)} day swing).`;
        try {
          await publishEvent({
            event_type:   "PAYMENT_DETERIORATION",
            severity,
            scope:        "customer",
            customer_id:  customerId,
            source_agent: agent_name,
            run_id,
            title:        `${companyName}: Payment timing deteriorating`,
            description:  summary,
            summary,
            payload: {
              severity_score:            severityToScore(severity),
              current_avg_days_to_pay:   trend.current_avg_days_late,
              prior_avg_days_to_pay:     trend.prior_avg_days_late,
              trend_direction,
              observation_window_days:   OBSERVATION_WINDOW_DAYS,
              summary,
            },
            is_demo: DEMO_MODE,
          });
          conditionsFound++;
        } catch (err) {
          console.error(`[payment-behaviour-agent] PAYMENT_DETERIORATION publishEvent failed for ${companyName}:`, (err as Error).message);
        }
      }

      // --- PAYMENT_IMPROVEMENT ---
      if (trend.improvement && !emittedToday.has(`${customerId}:PAYMENT_IMPROVEMENT`)) {
        const { severity, trend_direction } = trend.improvement;
        const summary = `${companyName}: average days late fell from ${trend.prior_avg_days_late} to ${trend.current_avg_days_late} days over the past ${OBSERVATION_WINDOW_DAYS} days (${swing.toFixed(1)} day swing).`;
        try {
          await publishEvent({
            event_type:   "PAYMENT_IMPROVEMENT",
            severity,
            scope:        "customer",
            customer_id:  customerId,
            source_agent: agent_name,
            run_id,
            title:        `${companyName}: Payment timing improving`,
            description:  summary,
            summary,
            payload: {
              severity_score:            severityToScore(severity),
              current_avg_days_to_pay:   trend.current_avg_days_late,
              prior_avg_days_to_pay:     trend.prior_avg_days_late,
              trend_direction,
              observation_window_days:   OBSERVATION_WINDOW_DAYS,
              summary,
            },
            is_demo: DEMO_MODE,
          });
          conditionsFound++;
        } catch (err) {
          console.error(`[payment-behaviour-agent] PAYMENT_IMPROVEMENT publishEvent failed for ${companyName}:`, (err as Error).message);
        }
      }

      // --- PAYMENT_VOLATILITY ---
      if (trend.volatility && !emittedToday.has(`${customerId}:PAYMENT_VOLATILITY`)) {
        const { severity, standard_deviation_days } = trend.volatility;
        const summary = `${companyName}: payment timing volatility over the past ${OBSERVATION_WINDOW_DAYS} days (stddev ${standard_deviation_days} days) — payment dates are becoming unpredictable.`;
        try {
          await publishEvent({
            event_type:   "PAYMENT_VOLATILITY",
            severity,
            scope:        "customer",
            customer_id:  customerId,
            source_agent: agent_name,
            run_id,
            title:        `${companyName}: Payment timing volatility`,
            description:  summary,
            summary,
            payload: {
              severity_score:           severityToScore(severity),
              standard_deviation_days,
              observation_window_days:  OBSERVATION_WINDOW_DAYS,
              summary,
            },
            is_demo: DEMO_MODE,
          });
          conditionsFound++;
        } catch (err) {
          console.error(`[payment-behaviour-agent] PAYMENT_VOLATILITY publishEvent failed for ${companyName}:`, (err as Error).message);
        }
      }
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      customers_scanned: scanned,
      conditions_found: conditionsFound,
      messages_composed: 0,
      summary: `Scanned ${scanned} customers with positive exposure. Emitted ${conditionsFound} payment-trend events.`,
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
