/**
 * Proposal → NEW_CREDIT_LIMIT pending action (written by CIA), and the pure
 * pieces of approval and activation (used by the onboarding function).
 *
 * Founder decision 2026-10-10: one approval path through pending_actions;
 * CIA stays the only writer of pending_actions. CIA's onboarding mode calls
 * createOnboardingAction; nothing here grants a limit.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import type { CreditApplication, OnboardingOutcome } from "./types.ts";
import { composeOnboardingMemo, type OnboardingMemo } from "../skills/analytical/compose-onboarding-memo.ts";

export const NEW_CREDIT_LIMIT = "NEW_CREDIT_LIMIT";
const DAY = 86_400_000;

export function severityFor(o: OnboardingOutcome): "critical" | "high" | "medium" | "info" {
  const p = o.proposal!;
  if (p.reason_codes.includes("SANCTIONS_MATCH")) return "critical";
  if (p.decision === "decline_review") return "high";
  if (p.decision === "counteroffer") return "medium";
  return "info";
}

/** The pending_actions row for a proposal. Pure: no I/O. */
export function proposalToAction(
  row: { id: string; customer_id: string; decision_due_at: string | null },
  app: CreditApplication, o: OnboardingOutcome,
  opts: { runId: string; isDemo: boolean; now: Date },
): Record<string, unknown> & { memo: OnboardingMemo } {
  const p = o.proposal;
  if (!p) throw new Error("No proposal to turn into an action");
  const memo = composeOnboardingMemo(app, o);
  // Reg B: a decision is due within 30 days of a completed application.
  const due = row.decision_due_at ? new Date(row.decision_due_at) : new Date(opts.now.getTime() + 30 * DAY);
  return {
    run_id: opts.runId,
    customer_id: row.customer_id,
    application_id: row.id,
    agent_name: "cia-agent",
    action_type: NEW_CREDIT_LIMIT,
    rationale: memo.text,
    memo,
    current_value: 0,
    proposed_value: p.decision === "decline_review" ? 0 : p.proposed_usd ?? 0,
    requested_value: p.requested_usd ?? app.credit_request.amount_usd ?? null,
    recommended_value: p.recommended_usd ?? null,
    supportable_value: p.supportable_usd ?? null,
    binding_method: p.binding_method ?? null,
    reason_codes: p.reason_codes,
    conditions: [],
    severity: severityFor(o),
    status: "pending",
    is_demo: opts.isDemo,
    expires_at: due.toISOString(),
  };
}

/** CIA onboarding mode: replace any open proposal for this application with a fresh one. */
export async function createOnboardingAction(db: SupabaseClient, applicationId: string, opts: { isDemo: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const { data: row, error } = await db.from("credit_applications")
    .select("id, customer_id, answers, outcome, status, decision_due_at").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Application not found");
  if (row.status === "decided" || row.status === "withdrawn") throw new Error(`Application is ${row.status}`);
  const outcome = row.outcome as OnboardingOutcome | null;
  if (!outcome?.proposal) throw new Error("The application has no proposal yet");
  const app = { ...(row.answers as Omit<CreditApplication, "application_id">), application_id: row.id } as CreditApplication;

  await db.from("pending_actions").update({ status: "expired" })
    .eq("application_id", row.id).eq("action_type", NEW_CREDIT_LIMIT).eq("status", "pending");

  // pending_actions.run_id must reference a CIA run (agent_runs), as for every CIA action.
  const { data: run, error: runErr } = await db.from("agent_runs").insert({
    agent_name: "cia-agent", status: "completed", started_at: now.toISOString(), completed_at: now.toISOString(),
    customers_scanned: 1, actions_taken: 1, triggered_by: "onboarding",
    summary: `Onboarding proposal for application ${row.id}`,
  }).select("id").single();
  if (runErr) throw new Error(`Could not record the CIA run: ${runErr.message}`);

  const action = proposalToAction(row, app, outcome, { runId: run.id as string, isDemo: opts.isDemo, now });
  const { data, error: insErr } = await db.from("pending_actions").insert(action).select("id").single();
  if (insErr) throw new Error(`Could not create the proposal: ${insErr.message}`);
  return { pending_action_id: data.id as string, headline: action.memo.headline, severity: action.severity };
}

/** What monitoring will later test against: the assumptions the approval rested on. Pure. */
export function underwritingAssumptions(app: CreditApplication, o: OnboardingOutcome, approvedUsd: number) {
  const a = o.analysis, p = o.proposal;
  return {
    approved_limit_usd: approvedUsd,
    requested_usd: p?.requested_usd ?? app.credit_request.amount_usd ?? null,
    payment_terms_days: app.credit_request.terms_days ?? null,
    invoicing_currency: app.credit_request.invoicing_currency ?? "USD",
    country_code: app.country_code ?? null,
    sector: app.sector ?? null,
    score: a?.score ?? null, band: a?.band ?? null, score_source: a?.score_source ?? null,
    financials_source: a?.financials_source ?? null, statement_quality: a?.statement_quality ?? null,
    needs_usd: p?.needs_usd ?? null, caps: p?.caps ?? null, supportable_usd: p?.supportable_usd ?? null,
    binding_method: p?.binding_method ?? null,
    macro_context_at_approval: (a?.macro_context ?? []).map((m) => ({ agent: m.source_agent, key: m.key, severity: m.severity, title: m.title })),
    screening_at_approval: o.screening ? { status: o.screening.status, people_screened: o.screening.people_screened, fraud_flags: o.screening.fraud_flags,
      hits: o.screening.hits.map((h) => ({ subject: h.subject, list_entry: h.list_entry, status: h.status })) } : null,
  };
}

/** Labels the final decision for the CREDIT_DECISION event. Pure. */
export function decisionLabel(decision: "approve" | "decline", approved: number, requested: number) {
  if (decision === "decline") return "declined" as const;
  return approved < requested ? "counteroffer" as const : "approve_as_requested" as const;
}
