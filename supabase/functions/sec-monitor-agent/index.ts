/**
 * SEC Filing Monitor Agent — supabase/functions/sec-monitor-agent/index.ts
 *
 * Actively fetches and analyses recent SEC filings for all monitored customers
 * via the SEC EDGAR API (free, no API key required). Detects risk signals in
 * filing text and writes credit_events for the CIA agent to synthesise.
 *
 * Request body: { triggered_by?: string }
 * Response:     { run_id: string, status: "completed" }
 *
 * Tables read:  sec_monitoring (with customers join), sec_filings (dedup check)
 * Tables written: sec_filings, credit_events, agent_messages, agent_runs,
 *                 sec_monitoring (last_checked_at, alert_triggered, alert_date, risk_signals_detected)
 *
 * Skills used: fetch-sec-filing.ts (EdgarProvider — EDGAR API, free, no key)
 *
 * Event types emitted (V1 taxonomy via publishEvent):
 *   GOING_CONCERN | SEC_OTHER
 *   (covenant_waiver and ceo_departure signals → SEC_OTHER with concern_category)
 *
 * Severity mapping:
 *   going_concern_warning / cash_runway_<3_quarters → critical
 *   covenant_waiver / CEO_departure                → high
 *   other                                          → medium
 *
 * Deduplication: accession_number per customer (sec_filings unique index).
 *   Skips filings already in sec_filings.
 *
 * Rate limit: 60 minutes between runs (HTTP 429 if exceeded).
 * Demo mode:  Returns a pre-baked run log. No rows written.
 *             Controlled by DEMO_MODE=true Supabase secret.
 * Max customers per run: 10.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { fetchSecFilings, fetchSeedSecFilings } from "../_shared/skills/integration/fetch-sec-filing.ts";
import { deliverMessage, LogProvider } from "../_shared/skills/integration/deliver-message.ts";
import { publishEvent } from "../_shared/publishEvent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MINUTES = 60;
const MAX_CUSTOMERS_PER_RUN = 10;
const CREDIT_TEAM_EMAIL = Deno.env.get("CREDIT_TEAM_EMAIL") ?? "credit-team@company.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { triggered_by } = await req.json().catch(() => ({ triggered_by: "manual" }));
  const agent_name = "sec_monitor_agent";
  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  // --- Rate limit check ---
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data: recentRuns } = await supabase
    .from("agent_runs")
    .select("id, started_at, status")
    .eq("agent_name", agent_name)
    .gte("started_at", cutoff)
    .in("status", ["completed", "running"])
    .limit(1);

  if (recentRuns && recentRuns.length > 0) {
    return new Response(JSON.stringify({
      error: "rate_limited",
      message: "This agent was run recently. Please wait before running again.",
      last_run_at: recentRuns[0].started_at,
    }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const run_id = crypto.randomUUID();

  await supabase.from("agent_runs").insert({
    id: run_id,
    agent_name,
    status: "running",
    started_at: new Date().toISOString(),
    triggered_by,
  });

  try {
    // 1. Load monitored customers (with customer join, is_demo filter, max 10)
    const { data: monitoring, error: monitoringError } = await supabase
      .from("sec_monitoring")
      .select("id, customer_id, cik, risk_signals_detected, customers!inner(company_name, ticker)")
      .eq("is_demo", DEMO_MODE)
      .limit(MAX_CUSTOMERS_PER_RUN);
    if (monitoringError) {
      console.error("sec_monitoring query failed:", JSON.stringify(monitoringError));
    }

    const scanned = monitoring?.length ?? 0;
    let conditionsFound = 0;
    let messagesComposed = 0;
    const now = new Date().toISOString();

    // 2. Process each monitored customer
    for (const row of (monitoring ?? [])) {
      const monitoringId = row.id as string;
      const customerId   = row.customer_id as string;
      const cik          = row.cik as string | null;
      const customer     = row.customers as { company_name: string; ticker: string | null };
      const companyName  = customer.company_name;

      if (!cik) {
        console.warn(`No CIK for customer ${customerId} (${companyName}) — skipping`);
        await supabase.from("sec_monitoring")
          .update({ last_checked_at: now })
          .eq("id", monitoringId);
        continue;
      }

      try {
        const filings = DEMO_MODE
          ? await fetchSeedSecFilings({ cik, company_name: companyName, days_back: 90 })
          : await fetchSecFilings({ cik, company_name: companyName, days_back: 90 });

        const newRiskSignals: string[] = [];
        let hasNewAlerts = false;

        for (const filing of filings) {
          // Dedup: accession_number is globally unique in EDGAR
          const { data: existing } = await supabase
            .from("sec_filings")
            .select("id")
            .eq("accession_number", filing.accession_number)
            .limit(1);

          if (existing && existing.length > 0) continue;

          // Insert to sec_filings (ON CONFLICT DO NOTHING via unique index)
          await supabase.from("sec_filings").insert({
            customer_id:      customerId,
            filing_type:      filing.filing_type,
            filing_date:      filing.filing_date,
            key_findings:     filing.key_findings,
            risk_signals:     filing.risk_signals,
            accession_number: filing.accession_number,
            document_url:     filing.document_url,
            cik:              filing.cik,
            provider:         filing.provider,
            agent_name,
            is_demo:          DEMO_MODE,
          });

          if (filing.risk_signals.length === 0) continue;

          // New alert filing
          hasNewAlerts = true;
          conditionsFound++;
          newRiskSignals.push(...filing.risk_signals);

          // Map risk signals to V1 event type + severity.
          // Only GOING_CONCERN uses a typed event — its required fields are all
          // extractable from EDGAR data. Covenant and CEO signals map to SEC_OTHER
          // because we don't extract the structured fields those typed events require.
          const isGoingConcern = filing.risk_signals.includes("going_concern_warning") ||
            filing.risk_signals.includes("cash_runway_<3_quarters");

          const severity = isGoingConcern ? "critical" as const
            : (
              filing.risk_signals.includes("covenant_waiver") ||
              filing.risk_signals.includes("CEO_departure")
            ) ? "high" as const
            : "medium" as const;

          const severityScore = severity === "critical" ? 92 : severity === "high" ? 75 : 52;

          // Normalise filing type to V1 FilingSourceTypeEnum
          const filingSourceType = (["10-K", "10-Q", "8-K"] as const).includes(
            filing.filing_type as "10-K" | "10-Q" | "8-K"
          ) ? filing.filing_type as "10-K" | "10-Q" | "8-K" : "other" as const;

          // Evidence URL is required for all SEC event payloads — skip if missing
          if (!filing.document_url) {
            console.warn(`No document_url for ${companyName} ${filing.accession_number} — skipping credit event`);
          } else if (isGoingConcern) {
            const title = `${companyName}: Going-concern doubt flagged in ${filing.filing_type} filing`;
            const summaryText = `${title}. Risk signals: ${filing.risk_signals.join(", ")}.`;
            await publishEvent({
              event_type:   "GOING_CONCERN",
              severity,
              scope:        "customer",
              customer_id:  customerId,
              source_agent: agent_name,
              title,
              description:  `Risk signals in ${filing.filing_type} (${filing.filing_date}): ${filing.risk_signals.join(", ")}`,
              summary:      summaryText,
              payload: {
                severity_score:     severityScore,
                filing_source_type: filingSourceType,
                evidence_url:       filing.document_url,
                summary:            summaryText,
              },
              is_demo: DEMO_MODE,
            });
          } else {
            const concernCategory = filing.risk_signals.includes("covenant_waiver") ? "covenant_waiver"
              : filing.risk_signals.includes("CEO_departure") ? "ceo_departure"
              : "other";
            const title = concernCategory === "covenant_waiver"
              ? `${companyName}: Covenant waiver disclosed in ${filing.filing_type} filing`
              : concernCategory === "ceo_departure"
              ? `${companyName}: CEO departure disclosed in ${filing.filing_type} filing`
              : `${companyName}: Notable item flagged in ${filing.filing_type} filing`;
            const summaryText = `${title}. Risk signals: ${filing.risk_signals.join(", ")}.`;
            await publishEvent({
              event_type:   "SEC_OTHER",
              severity,
              scope:        "customer",
              customer_id:  customerId,
              source_agent: agent_name,
              title,
              description:  `Risk signals in ${filing.filing_type} (${filing.filing_date}): ${filing.risk_signals.join(", ")}`,
              summary:      summaryText,
              payload: {
                severity_score:     severityScore,
                filing_source_type: filingSourceType,
                concern_category:   concernCategory,
                evidence_url:       filing.document_url,
                summary:            summaryText,
              },
              is_demo: DEMO_MODE,
            });
          }

          // Compose email alert
          const alertSubject = `SEC Alert: ${companyName} (${customer.ticker ?? cik}) — ${filing.risk_signals.length} risk signal(s) in ${filing.filing_type}`;
          const alertBody = [
            `SEC Filing Alert`,
            `Company: ${companyName} (${customer.ticker ?? "N/A"})`,
            `CIK: ${cik}`,
            `Filing Type: ${filing.filing_type}`,
            `Filing Date: ${filing.filing_date}`,
            ``,
            `Risk Signals: ${filing.risk_signals.join(", ")}`,
            ``,
            `Key Findings: ${filing.key_findings || "(text not extracted)"}`,
            ``,
            `Filing URL: ${filing.document_url}`,
            ``,
            `Please review the filing and assess impact on credit exposure.`,
          ].join("\n");

          const { error: msgError } = await supabase.from("agent_messages").insert({
            run_id,
            agent_name,
            customer_id:     customerId,
            channel:         "email",
            template_type:   "sec_alert",
            recipient_type:  "credit_committee",
            recipient_name:  "Credit Analysis Team",
            recipient_email: CREDIT_TEAM_EMAIL,
            subject:         alertSubject,
            body:            alertBody,
            status:          "draft",
            is_demo:         DEMO_MODE,
          });
          if (!msgError) messagesComposed++;

          // Attempt delivery (LogProvider fallback always succeeds)
          await deliverMessage(
            { channel: "email", recipient: CREDIT_TEAM_EMAIL, subject: alertSubject, body: alertBody },
            [new LogProvider()]
          );
        }

        // Update sec_monitoring with latest alert state + last_checked_at
        const updatePayload: Record<string, unknown> = { last_checked_at: now };
        if (hasNewAlerts) {
          updatePayload.alert_triggered = true;
          updatePayload.alert_date      = now.slice(0, 10);
          updatePayload.risk_signals_detected = [...new Set(newRiskSignals)];
        }
        await supabase.from("sec_monitoring")
          .update(updatePayload)
          .eq("id", monitoringId);

      } catch (err) {
        console.error(`Failed to process ${companyName} (CIK: ${cik}):`, (err as Error).message);
        // Non-fatal — continue with next customer
        await supabase.from("sec_monitoring")
          .update({ last_checked_at: now })
          .eq("id", monitoringId);
      }
    }

    await supabase.from("agent_runs").update({
      status:            "completed",
      completed_at:      now,
      customers_scanned: scanned,
      conditions_found:  conditionsFound,
      messages_composed: messagesComposed,
      actions_taken:     0,
      summary: `Scanned ${scanned} customers via EDGAR. Found ${conditionsFound} new risk signals. Composed ${messagesComposed} alerts.`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ run_id, status: "completed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    await supabase.from("agent_runs").update({
      status:       "failed",
      completed_at: new Date().toISOString(),
      summary:      `Error: ${(err as Error).message}`,
    }).eq("id", run_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
