/**
 * onboarding — runs the New Customer Onboarding pipeline for real.
 *
 * Every call needs a signed-in CreditPilot user (requireUser).
 *
 *   POST { action: "submit", application, submitted_via? }      admin, credit_manager, credit_analyst
 *        Creates the prospect (customers.lifecycle_status = 'prospect', credit_limit 0)
 *        and the credit_applications row, then runs the pipeline. An applicant that
 *        is already a customer is attached to that customer instead (no duplicate).
 *   POST { action: "run", application_id }                       admin, credit_manager, credit_analyst
 *        Re-runs the pipeline (after the applicant supplies missing items, or a disposition).
 *   POST { action: "dispose_hit", hit_id, disposition, note }    admin, credit_manager
 *        A person clears or confirms a sanctions match, then the pipeline re-runs.
 *   POST { action: "accept_fraud_flags", application_id, note }  admin, credit_manager
 *        A person accepts the fraud flags after checking them, then the pipeline re-runs.
 *   POST { action: "assign", application_id, credit_assignee?, sales_assignee? }  admin, credit_manager, credit_analyst
 *        Sets who works the application (user ids; null clears).
 *   POST { action: "decide", pending_action_id, decision: "approve" | "decline", approved_value?, note? }
 *        admin, credit_manager. Four-eyes: not the person who submitted the application
 *        (admins excepted). Approve activates the customer (limit, terms, underwriting
 *        baseline, NEW_CREDIT_LIMIT credit action, CREDIT_DECISION + CUSTOMER_ACTIVATED);
 *        decline marks the prospect declined. A note is required to decline, to change
 *        the amount, or to approve a proposal that was not "approve".
 *
 * After every run that ends with a proposal, CIA's onboarding mode turns it into a
 * NEW_CREDIT_LIMIT pending action (CIA stays the only writer of pending_actions).
 *
 * Writes: customers (prospect row only), credit_applications, screening_runs/checks/hits,
 * score_results, and onboarding events via publishEvent (cia_processed = true, so the
 * monitoring briefing never reads prospects).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { AuthError, requireUser, type AuthedUser } from "../_shared/auth.ts";
import { runOnboarding, type RunOptions } from "../_shared/onboarding/pipeline.ts";
import { liveProviders } from "../_shared/onboarding/live_providers.ts";
import { effectiveSettings } from "../_shared/onboarding/settings_validate.ts";
import type { CreditApplication, OnboardingOutcome, OnboardingSettings } from "../_shared/onboarding/types.ts";
import { publishEvent } from "../_shared/publishEvent.ts";
import { SectorEnum } from "../_shared/event_schemas.ts";
import { NEW_CREDIT_LIMIT, decisionLabel, underwritingAssumptions } from "../_shared/onboarding/decision.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RUNNERS = ["admin", "credit_manager", "credit_analyst"] as const;
const DISPOSERS = ["admin", "credit_manager"] as const;
const REG_B_DAYS = 30;
const DAY = 86_400_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    switch (body?.action) {
      case "submit": {
        const user = await requireUser(req, [...RUNNERS]);
        return json(await submit(db, user, body, req));
      }
      case "run": {
        const user = await requireUser(req, [...RUNNERS]);
        return json(await run(db, user, String(body.application_id), req));
      }
      case "dispose_hit": {
        const user = await requireUser(req, [...DISPOSERS]);
        return json(await disposeHit(db, user, body, req));
      }
      case "accept_fraud_flags": {
        const user = await requireUser(req, [...DISPOSERS]);
        return json(await acceptFlags(db, user, body, req));
      }
      case "assign": {
        const user = await requireUser(req, [...RUNNERS]);
        return json(await assign(db, user, body));
      }
      case "decide": {
        const user = await requireUser(req, [...DISPOSERS]);
        return json(await decide(db, user, body));
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error("[onboarding]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

class UserError extends Error {}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function submit(db: SupabaseClient, user: AuthedUser, body: Record<string, unknown>, req: Request) {
  const app = body.application as Omit<CreditApplication, "application_id"> | undefined;
  if (!app?.legal_name?.trim()) throw new UserError("application.legal_name is required");
  if (!app.country_code || !/^[A-Z]{2}$/.test(app.country_code.toUpperCase())) throw new UserError("application.country_code must be a 2-letter country code");
  app.country_code = app.country_code.toUpperCase();
  app.people ??= []; app.trade_references ??= []; app.financial_statements ??= []; app.signatures ??= {};
  app.credit_request ??= {};
  const via = (["staff", "sales", "buyer_link"] as const).includes(body.submitted_via as never) ? body.submitted_via as string : "staff";

  const providers = providersFor(db);
  const existing = await providers.findExistingCustomer({ ...app, application_id: "pending" });
  let customerId = existing?.customer_id;
  if (!customerId) {
    const sector = SectorEnum.safeParse(app.sector).success ? app.sector : "Other";
    const { data, error } = await db.from("customers").insert({
      company_name: app.legal_name.trim(),
      lifecycle_status: "prospect",
      credit_limit: 0, current_exposure: 0,
      payment_terms_days: app.credit_request.terms_days ?? 30,
      sector, industry: app.sector ?? null,
      country_code: app.country_code,
      company_type: app.is_public ? "public" : "private",
      website: app.website ?? null, trade_name: app.trade_name ?? null,
      invoicing_currency: app.credit_request.invoicing_currency ?? "USD",
      street_address: app.billing_address?.line1 ?? null, city: app.billing_address?.city ?? null,
      postcode: app.billing_address?.postal_code ?? null,
      notes: "Prospect created by onboarding",
    }).select("id").single();
    if (error) throw new Error(`Could not create prospect: ${error.message}`);
    customerId = data.id as string;
    const ids = [["tax_id", app.tax_id], ["duns", app.duns]].filter(([, v]) => v) as [string, string][];
    if (ids.length) {
      await db.from("customer_identifiers").insert(ids.map(([id_type, id_value]) => ({
        customer_id: customerId, id_type, id_value, is_primary: false, source: "customer_supplied",
      })));
    }
  }

  const { data: row, error } = await db.from("credit_applications").insert({
    customer_id: customerId,
    status: "submitted",
    answers: app,
    requested_limit_usd: app.credit_request.amount_usd ?? null,
    requested_terms_days: app.credit_request.terms_days ?? null,
    submitted_via: via,
    submitted_by: user.user_id,
    credit_assignee: user.role === "sales" ? null : user.user_id,
    sales_assignee: user.role === "sales" ? user.user_id : null,
  }).select("id").single();
  if (error) throw new Error(`Could not save application: ${error.message}`);
  return await run(db, user, row.id as string, req);
}

async function run(db: SupabaseClient, user: AuthedUser, applicationId: string, req: Request, cleared?: RunOptions["cleared"]) {
  const { data: row, error } = await db.from("credit_applications").select("*").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new UserError("Application not found");
  if (row.status === "decided" || row.status === "withdrawn") throw new UserError(`Application is ${row.status}`);

  const app: CreditApplication = { ...(row.answers as Omit<CreditApplication, "application_id">), application_id: row.id };
  const settings = await loadSettings(db);
  const prior = (row.outcome as { cleared?: RunOptions["cleared"] } | null)?.cleared;
  const mergedCleared = mergeCleared(prior, cleared);

  let outcome: OnboardingOutcome;
  try {
    outcome = await runOnboarding(app, providersFor(db, row.customer_id), { settings, cleared: mergedCleared });
  } catch (e) {
    // Fail closed (e.g. sanctions lists stale): the application waits at Screening.
    const message = e instanceof Error ? e.message : String(e);
    await db.from("credit_applications").update({
      stage: "screening", status: "in_review",
      outcome: { ...(row.outcome ?? {}), error: message, error_at: new Date().toISOString(), cleared: mergedCleared },
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { application_id: row.id, error: message, stopped_at: "screening" };
  }

  await persist(db, user, row, app, outcome, mergedCleared);

  // A finished proposal goes to CIA, which writes the NEW_CREDIT_LIMIT action for a person.
  let proposal_action: unknown = null;
  if (outcome.proposal && outcome.route !== "existing_customer_limit_review") {
    proposal_action = await sendToCia(req, row.id);
  }
  return { application_id: row.id, customer_id: row.customer_id, outcome, proposal_action };
}

async function sendToCia(req: Request, applicationId: string) {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/cia-agent`, {
      method: "POST",
      headers: {
        Authorization: req.headers.get("Authorization") ?? "",
        apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "onboarding", application_id: applicationId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (j as { error?: string }).error ?? `CIA returned ${r.status}` };
    return j;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function disposeHit(db: SupabaseClient, user: AuthedUser, body: Record<string, unknown>, req: Request) {
  const disposition = body.disposition;
  const note = String(body.note ?? "").trim();
  if (disposition !== "cleared" && disposition !== "confirmed") throw new UserError("disposition must be 'cleared' or 'confirmed'");
  if (note.length < 10) throw new UserError("A note explaining the decision is required (at least 10 characters)");
  const { data: hit, error } = await db.from("screening_hits")
    .select("id, subject_name, matched_name, disposition, screening_runs(application_id)").eq("id", String(body.hit_id)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!hit) throw new UserError("Hit not found");
  if (hit.disposition !== "open") throw new UserError(`Hit is already ${hit.disposition}`);
  await db.from("screening_hits").update({
    disposition, disposition_by: user.user_id, disposition_note: note, disposed_at: new Date().toISOString(),
  }).eq("id", hit.id);
  const applicationId = (hit.screening_runs as unknown as { application_id: string }).application_id;
  if (disposition === "confirmed") {
    return { application_id: applicationId, hit_id: hit.id, disposition, next: "A confirmed match stops onboarding; decline from the application page." };
  }
  return await run(db, user, applicationId, req, { hits: [{ subject: hit.subject_name, list_entry: hit.matched_name }] });
}

async function acceptFlags(db: SupabaseClient, user: AuthedUser, body: Record<string, unknown>, req: Request) {
  const note = String(body.note ?? "").trim();
  if (note.length < 10) throw new UserError("A note explaining the decision is required (at least 10 characters)");
  const applicationId = String(body.application_id);
  const { data: lastRun } = await db.from("screening_runs").select("id").eq("application_id", applicationId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (lastRun) {
    await db.from("screening_checks").insert({
      run_id: lastRun.id, check_type: "fraud_flags_accepted", result: "pass",
      detail: { accepted_by: user.user_id, accepted_by_email: user.email, note }, source: "person",
    });
  }
  return await run(db, user, applicationId, req, { fraud_flags_accepted: true });
}

async function assign(db: SupabaseClient, user: AuthedUser, body: Record<string, unknown>) {
  const update: Record<string, string | null> = {};
  for (const key of ["credit_assignee", "sales_assignee"] as const) {
    if (!(key in body)) continue;
    const id = body[key] === null || body[key] === "" ? null : String(body[key]);
    if (id) {
      const { data: target } = await db.from("app_users").select("user_id, role, active").eq("user_id", id).maybeSingle();
      if (!target?.active) throw new UserError(`${key}: not an active CreditPilot user`);
    }
    update[key] = id;
  }
  if (!Object.keys(update).length) throw new UserError("Nothing to assign");
  const { error } = await db.from("credit_applications").update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", String(body.application_id));
  if (error) throw new Error(error.message);
  void user;
  return { application_id: body.application_id, ...update };
}

async function decide(db: SupabaseClient, user: AuthedUser, body: Record<string, unknown>) {
  const decision = body.decision;
  if (decision !== "approve" && decision !== "decline") throw new UserError("decision must be 'approve' or 'decline'");
  const note = String(body.note ?? "").trim();

  const { data: action, error } = await db.from("pending_actions").select("*").eq("id", String(body.pending_action_id)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!action || action.action_type !== NEW_CREDIT_LIMIT) throw new UserError("New-customer proposal not found");
  if (action.status !== "pending") throw new UserError(`This proposal is already ${action.status}`);

  const { data: row } = await db.from("credit_applications").select("*").eq("id", action.application_id).maybeSingle();
  if (!row) throw new UserError("Application not found");
  if (row.submitted_by === user.user_id && user.role !== "admin") {
    throw new UserError("Four-eyes rule: the person who submitted this application cannot also decide it");
  }
  const outcome = row.outcome as OnboardingOutcome;
  const app = { ...(row.answers as Omit<CreditApplication, "application_id">), application_id: row.id } as CreditApplication;
  const requested = Number(action.requested_value ?? app.credit_request.amount_usd ?? 0);
  const now = new Date().toISOString();
  const isDemo = (Deno.env.get("DEMO_MODE") ?? "false") === "true";

  if (decision === "decline") {
    if (note.length < 10) throw new UserError("A note explaining the decline is required (at least 10 characters)");
    await db.from("pending_actions").update({ status: "rejected", reviewed_by: user.email, reviewed_by_user: user.user_id,
      reviewed_at: now, review_note: note, decided_value: 0 }).eq("id", action.id);
    await db.from("customers").update({ lifecycle_status: "declined", updated_at: now }).eq("id", row.customer_id).eq("lifecycle_status", "prospect");
    await db.from("credit_applications").update({ status: "decided", stage: "decision", updated_at: now,
      outcome: { ...outcome, decision: { decision: "declined", by: user.email, at: now, note } } }).eq("id", row.id);
    await publishEvent({
      event_type: "CREDIT_DECISION", scope: "customer", customer_id: row.customer_id, source_agent: "onboarding",
      title: `Credit declined: ${app.legal_name}`, description: note, summary: `Declined by ${user.display_name}: ${note}`,
      payload: { application_id: row.id, severity_score: 7, decision: "declined", requested_limit_usd: requested, approved_limit_usd: null,
        reason_codes: outcome.proposal?.reason_codes ?? [], decided_by: user.user_id, summary: `Declined by ${user.display_name}: ${note}` },
      is_demo: isDemo, cia_processed: true,
    });
    return { application_id: row.id, decision: "declined",
      next: "Send the applicant a written notice of the decline (Reg B: within 30 days of the completed application)." };
  }

  // Approve: never over an open or confirmed sanctions match.
  const { data: runs } = await db.from("screening_runs").select("id").eq("application_id", row.id).order("started_at", { ascending: false }).limit(1);
  if (runs?.[0]) {
    const { data: openHits } = await db.from("screening_hits").select("id, disposition").eq("run_id", runs[0].id).in("disposition", ["open", "confirmed"]);
    if (openHits?.length) throw new UserError("Screening has an open or confirmed sanctions match; it must be cleared at Screening before any approval");
  }
  if (outcome.screening && outcome.screening.status !== "pass") throw new UserError("Screening has not passed");

  const approved = Math.round(Number(body.approved_value ?? action.proposed_value));
  if (!Number.isFinite(approved) || approved <= 0) throw new UserError("approved_value must be a positive amount");
  const override = approved !== Number(action.proposed_value) || outcome.proposal?.decision === "decline_review";
  if (override && note.length < 10) throw new UserError("A note is required when the amount differs from the proposal or the proposal was not to approve");

  await db.from("pending_actions").update({ status: "approved", reviewed_by: user.email, reviewed_by_user: user.user_id,
    reviewed_at: now, review_note: note || null, decided_value: approved }).eq("id", action.id);

  const { data: baseline, error: bErr } = await db.from("underwriting_baseline").insert({
    customer_id: row.customer_id, application_id: row.id, approved_limit_usd: approved,
    assumptions: underwritingAssumptions(app, outcome, approved), reason_codes: outcome.proposal?.reason_codes ?? [],
    memo: action.memo ?? null, approved_by: user.user_id,
  }).select("id").single();
  if (bErr) throw new Error(`Could not store the underwriting baseline: ${bErr.message}`);

  const { error: cErr } = await db.from("customers").update({
    lifecycle_status: "active", credit_limit: approved, payment_terms_days: app.credit_request.terms_days ?? 30,
    customer_since: now.slice(0, 10), last_reviewed: now.slice(0, 10), updated_at: now,
  }).eq("id", row.customer_id);
  if (cErr) throw new Error(`Could not activate the customer: ${cErr.message}`);

  await db.from("credit_actions").insert({
    customer_id: row.customer_id, action_date: now.slice(0, 10), action_type: NEW_CREDIT_LIMIT,
    description: `New customer approved at ${approved.toLocaleString("en-US")} USD (requested ${requested.toLocaleString("en-US")}).${note ? " " + note : ""}`,
    old_limit: 0, new_limit: approved, performed_by: user.email, agent_name: "cia-agent", reviewed_by: user.email, reviewed_at: now,
  });

  await db.from("credit_applications").update({ status: "decided", stage: "active", updated_at: now,
    outcome: { ...outcome, decision: { decision: "approved", approved_limit_usd: approved, by: user.email, at: now, note: note || null, baseline_id: baseline.id } },
  }).eq("id", row.id);

  const label = decisionLabel("approve", approved, requested);
  const summary = `Approved ${approved.toLocaleString("en-US")} USD (requested ${requested.toLocaleString("en-US")}) by ${user.display_name}.`;
  await publishEvent({
    event_type: "CREDIT_DECISION", scope: "customer", customer_id: row.customer_id, source_agent: "onboarding",
    title: `Credit approved: ${app.legal_name}`, description: summary, summary,
    payload: { application_id: row.id, severity_score: 7, decision: label, requested_limit_usd: requested, approved_limit_usd: approved,
      reason_codes: outcome.proposal?.reason_codes ?? [], decided_by: user.user_id, summary },
    is_demo: isDemo, cia_processed: true,
  });
  await publishEvent({
    event_type: "CUSTOMER_ACTIVATED", scope: "customer", customer_id: row.customer_id, source_agent: "onboarding",
    title: `Now monitored: ${app.legal_name}`, description: "Activated with an underwriting baseline; monitoring agents now include this customer.",
    payload: { application_id: row.id, severity_score: 7, approved_limit_usd: approved, payment_terms_days: app.credit_request.terms_days ?? 30, baseline_id: baseline.id },
    is_demo: isDemo, cia_processed: true,
  });
  return { application_id: row.id, decision: "approved", approved_limit_usd: approved, baseline_id: baseline.id, customer_id: row.customer_id };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

type AppRow = { id: string; customer_id: string; outcome: Record<string, unknown> | null; clock_started_at: string | null; decision_due_at: string | null };

async function persist(db: SupabaseClient, user: AuthedUser, row: AppRow, app: CreditApplication, o: OnboardingOutcome, cleared: RunOptions["cleared"]) {
  const now = new Date();
  const isDemo = (Deno.env.get("DEMO_MODE") ?? "false") === "true";

  let status = "in_review";
  if (o.route === "existing_customer_limit_review") status = "decided";
  else if (o.completeness?.status === "incomplete") status = "incomplete";
  const stage = o.stopped_at === "decision" ? "decision" : o.stopped_at;

  const clockStarted = o.completeness?.status === "incomplete" ? (row.clock_started_at ?? now.toISOString()) : row.clock_started_at;
  const decisionDue = o.completeness?.status === "complete" ? (row.decision_due_at ?? new Date(now.getTime() + REG_B_DAYS * DAY).toISOString()) : row.decision_due_at;

  // Screening audit trail: every run is kept.
  let screeningRunId: string | undefined;
  if (o.screening) {
    const { data: sr, error } = await db.from("screening_runs").insert({
      application_id: row.id, result: o.screening.status, run_by: user.user_id, completed_at: now.toISOString(),
      summary: { checks: o.screening.checks, fraud_flags: o.screening.fraud_flags, people_screened: o.screening.people_screened },
    }).select("id").single();
    if (error) throw new Error(`Could not save screening: ${error.message}`);
    screeningRunId = sr.id as string;
    const checks = [
      ...o.screening.checks.map((c) => ({ run_id: screeningRunId, check_type: c, result: c === "registry_unavailable" ? "skipped" : "pass", source: c.split(":")[1] ?? null })),
      ...o.screening.fraud_flags.map((f) => ({ run_id: screeningRunId, check_type: `fraud_flag:${f}`, result: cleared?.fraud_flags_accepted ? "pass" : "review", source: "pipeline" })),
    ];
    if (checks.length) await db.from("screening_checks").insert(checks);
    // Hits a person already disposed keep their disposition; only new open hits are inserted.
    const openHits = o.screening.hits.filter((h) => h.status === "open");
    if (openHits.length) {
      await db.from("screening_hits").insert(openHits.map((h) => ({
        run_id: screeningRunId, subject_name: h.subject, subject_role: h.subject_type, list_name: h.list,
        matched_name: h.list_entry, similarity: h.similarity, country: h.list_country ?? null,
        detail: { subject_type: h.subject_type, list_country: h.list_country ?? null, list_dob: h.list_dob ?? null,
          country_match: h.country_match ?? null, dob_match: h.dob_match ?? null },
      })));
    }
  }

  if (o.analysis) {
    const rows: Record<string, unknown>[] = o.analysis.fallbacks
      .filter((f) => f.provider === "file" || f.provider === "bureau_report")
      .map((f) => ({ application_id: row.id, provider: f.provider, status: f.reason === "timeout" ? "timeout" : "error", detail: { reason: f.reason } }));
    if (o.analysis.score_source) {
      rows.push({
        application_id: row.id, provider: o.analysis.score_source, status: "ok", score: o.analysis.score, band: o.analysis.band ?? null,
        max_credit_recommendation_usd: o.proposal?.caps?.bureau_recommendation ?? null,
        inputs: { financials_source: o.analysis.financials_source, statement_quality: o.analysis.statement_quality },
        as_of: now.toISOString().slice(0, 10),
      });
    }
    if (rows.length) await db.from("score_results").insert(rows);
  }

  await db.from("credit_applications").update({
    stage, status,
    completeness: o.completeness ?? null,
    outcome: { ...o, cleared, error: null, run_at: now.toISOString(), run_by: user.email },
    clock_started_at: clockStarted, decision_due_at: decisionDue,
    updated_at: now.toISOString(),
  }).eq("id", row.id);

  // Events: each onboarding event type once per application.
  const { data: prior } = await db.from("credit_events").select("event_type")
    .eq("customer_id", row.customer_id).eq("payload->>application_id", row.id);
  const already = new Set((prior ?? []).map((e: { event_type: string }) => e.event_type));
  const name = app.legal_name;
  for (const type of o.events) {
    if (already.has(type)) continue;
    const ev = eventFor(type, row, app, o, screeningRunId, clockStarted);
    if (!ev) continue;
    await publishEvent({
      event_type: type as never, scope: "customer", customer_id: row.customer_id,
      source_agent: "onboarding", title: `${ev.title}: ${name}`, description: ev.summary, summary: ev.summary,
      payload: ev.payload, is_demo: isDemo, cia_processed: true,
    });
  }
}

function eventFor(type: string, row: AppRow, app: CreditApplication, o: OnboardingOutcome, runId: string | undefined, clock: string | null):
  { title: string; summary: string; payload: Record<string, unknown> } | null {
  const base = { application_id: row.id };
  const req = app.credit_request.amount_usd ?? 0;
  const usd = (n?: number) => (n === undefined ? "n/a" : `$${Math.round(n).toLocaleString("en-US")}`);
  switch (type) {
    case "APPLICATION_SUBMITTED":
      return { title: "Credit application received", summary: `Requested ${usd(req)} on ${app.credit_request.terms_days ?? 30}-day terms.`,
        payload: { ...base, severity_score: 7, requested_limit_usd: req, requested_terms_days: app.credit_request.terms_days ?? 30,
          submitted_via: "staff", country_code: app.country_code } };
    case "APPLICATION_INCOMPLETE": {
      const start = clock ?? new Date().toISOString();
      return { title: "Credit application incomplete", summary: `Missing: ${o.completeness!.missing.join(", ")}.`,
        payload: { ...base, severity_score: 27, missing_items: o.completeness!.missing, clock_started_at: start,
          response_due_at: new Date(Date.parse(start) + REG_B_DAYS * DAY).toISOString(),
          summary: `Missing: ${o.completeness!.missing.join(", ")}.` } };
    }
    case "SCREENING_PASS":
      return { title: "Screening passed", summary: `The entity and ${o.screening!.people_screened} ${o.screening!.people_screened === 1 ? "person" : "people"} screened; no open matches.`,
        payload: { ...base, severity_score: 7, screening_run_id: runId, subjects_screened: o.screening!.people_screened + 1 } };
    case "SCREENING_REVIEW": {
      const open = o.screening!.hits.filter((h) => h.status === "open").length;
      const summary = `${open} possible sanctions match(es)${o.screening!.fraud_flags.length ? `; fraud flags: ${o.screening!.fraud_flags.join(", ")}` : ""}. A person must review.`;
      return { title: "Screening needs review", summary,
        payload: { ...base, severity_score: 52, screening_run_id: runId, open_hits: open, fraud_flags: o.screening!.fraud_flags, summary } };
    }
    case "SANCTIONS_HIT": {
      const h = o.screening!.hits.find((x) => x.status === "open")!;
      const summary = `${h.subject} matches ${h.list_entry} on the ${h.list} list (similarity ${h.similarity}). Onboarding stopped; a person decides.`;
      return { title: "Sanctions match", summary,
        payload: { ...base, severity_score: 92, screening_run_id: runId, subject_name: h.subject, list_name: h.list,
          matched_name: h.list_entry, similarity: h.similarity, summary } };
    }
    case "CREDIT_ANALYSIS_COMPLETE": {
      const p = o.proposal!, a = o.analysis!;
      const summary = `${p.decision.replace(/_/g, " ")}: proposed ${usd(p.proposed_usd)} (requested ${usd(p.requested_usd)}, supportable ${usd(p.supportable_usd)}). Score ${a.score ?? "n/a"} from ${a.score_source ?? "no source"}.`;
      return { title: "Credit analysis complete", summary,
        payload: { ...base, severity_score: 7, score_provider: a.score_source ?? null, score: a.score ?? null, band: a.band ?? null,
          requested_limit_usd: p.requested_usd ?? 0, recommended_limit_usd: p.recommended_usd ?? 0, supportable_limit_usd: p.supportable_usd ?? 0,
          macro_haircut_applied: p.macro_haircut_applied, reason_codes: p.reason_codes, summary } };
    }
    default:
      return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function providersFor(db: SupabaseClient, excludeCustomerId?: string) {
  return liveProviders({
    db, env: (k) => Deno.env.get(k), excludeCustomerId,
    isDemo: (Deno.env.get("DEMO_MODE") ?? "false") === "true",
  });
}

async function loadSettings(db: SupabaseClient): Promise<OnboardingSettings> {
  const { data } = await db.from("company_settings").select("key, value").like("key", "onboarding.%");
  const eff = effectiveSettings(Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]))) as Record<string, unknown>;
  return { template: eff.template, screening: eff.screening, limits: eff.limits, sources: eff.sources } as OnboardingSettings;
}

function mergeCleared(a?: RunOptions["cleared"], b?: RunOptions["cleared"]): RunOptions["cleared"] {
  if (!a && !b) return undefined;
  return {
    hits: [...(a?.hits ?? []), ...(b?.hits ?? [])],
    fraud_flags_accepted: !!(a?.fraud_flags_accepted || b?.fraud_flags_accepted),
  };
}
