/**
 * demo-actions — supabase/functions/demo-actions/index.ts
 *
 * Server-side gateway for the demo-mode write flows that previously wrote
 * directly to Postgres via the anon key from the browser (approve/reject in
 * Actions.tsx, and the full reset in initDemo.ts). All writes here run under
 * the service role key so the underlying tables can be locked down to
 * anon-read-only (see 20260920000000_tighten_anon_write_rls.sql).
 *
 * Request body: { action: "approve" | "reject" | "reset", ... }
 *
 *   approve: { action: "approve", pending_action_id, note }   (values read from the stored proposal)
 *   reject:  { action: "reject", pending_action_id, note }
 *   reset:   { action: "reset" }
 *
 * Response: { ok: true } | { error: string }
 *
 * Production (DEMO_MODE not "true"): approve / reject need a signed-in admin or credit
 * manager; reset answers 404.
 *
 * Tables written: pending_actions, customers, credit_actions, credit_events,
 *                 negative_news, agent_messages, invoices (via RPC)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { AuthError, requireUser } from "../_shared/auth.ts";
import { inBackground, replayDemoAgents } from "../_shared/demo_replay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Same 3 demo customers reset by the original client-side initDemo().
const SEED_CREDIT_LIMITS = [
  { id: "c0000001-0000-0000-0000-000000000029", limit: 3000000 },
  { id: "c0000001-0000-0000-0000-000000000008", limit: 4500000 },
  { id: "c0000001-0000-0000-0000-000000000005", limit: 5000000 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Demo: anyone may approve, reject or reset (shared demo data, values from the stored
  // proposal). Production: approve / reject need a signed-in admin or credit manager,
  // recorded under their name, and reset does not exist.
  const DEMO = Deno.env.get("DEMO_MODE") === "true";

  try {
    const body = await req.json();
    const action = body?.action;
    let reviewer = "demo_user";
    if (!DEMO && action === "reset") return json({ error: "Not found" }, 404);
    if (!DEMO && (action === "approve" || action === "reject")) {
      // Production: a signed-in admin or credit manager, recorded under their name.
      // Demo (by design, founder 2026-11-17): anyone may try approving or rejecting; the
      // values always come from the stored proposal, and Reset Demo / the daily refresh
      // put everything back.
      try {
        const u = await requireUser(req, ["admin", "credit_manager"]);
        reviewer = u.email;
      } catch (e) {
        return json({ error: e instanceof AuthError ? e.message : "Sign in required" }, e instanceof AuthError ? e.status : 401);
      }
    }

    if (action === "approve") {
      const { pending_action_id, note } = body;
      if (!pending_action_id) return json({ error: "Missing pending_action_id" }, 400);

      // Every value comes from the stored proposal, never from the request: a visitor can
      // approve what an agent proposed, not set any customer's limit to any number.
      const { data: pa, error: e0 } = await supabase
        .from("pending_actions")
        .select("id, status, is_demo, action_type, customer_id, current_value, proposed_value, agent_name, rationale")
        .eq("id", pending_action_id)
        .maybeSingle();
      if (e0) return json({ error: e0.message }, 500);
      if (!pa || pa.is_demo !== DEMO) return json({ error: "Unknown action" }, 404);
      if (pa.action_type === "NEW_CREDIT_LIMIT") {
        return json({ error: "New-customer limits are decided through onboarding (signed-in credit manager)" }, 400);
      }
      if (pa.status !== "pending") return json({ error: `This action is already ${pa.status}` }, 409);

      const { error: e1 } = await supabase
        .from("pending_actions")
        .update({
          status: "approved",
          reviewed_by: reviewer,
          reviewed_at: new Date().toISOString(),
          review_note: note || null,
        })
        .eq("id", pending_action_id)
        .eq("status", "pending");
      if (e1) return json({ error: e1.message }, 500);

      if (pa.action_type === "CREDIT_LIMIT_REDUCTION" && pa.proposed_value != null && pa.customer_id) {
        const { error: e2 } = await supabase
          .from("customers")
          .update({ credit_limit: pa.proposed_value })
          .eq("id", pa.customer_id);
        if (e2) return json({ error: e2.message }, 500);
      }

      const { error: e3 } = await supabase.from("credit_actions").insert({
        customer_id: pa.customer_id,
        action_date: new Date().toISOString().split("T")[0],
        action_type: pa.action_type,
        description: `Approved. ${note ? note + ". " : ""}${pa.rationale ?? ""}`,
        agent_name: pa.agent_name,
        old_limit: pa.current_value,
        new_limit: pa.proposed_value,
        performed_by: reviewer,
      });
      if (e3) return json({ error: e3.message }, 500);

      return json({ ok: true });
    }

    if (action === "reject") {
      const { pending_action_id, note } = body;
      if (!pending_action_id) return json({ error: "Missing pending_action_id" }, 400);
      const { data: own } = await supabase.from("pending_actions").select("is_demo").eq("id", pending_action_id).maybeSingle();
      if (!own || own.is_demo !== DEMO) return json({ error: "Unknown action" }, 404);
      if (await isNewCustomerProposal(supabase, pending_action_id)) {
        return json({ error: "New-customer limits are decided through onboarding (signed-in credit manager)" }, 400);
      }

      const { error } = await supabase
        .from("pending_actions")
        .update({
          status: "rejected",
          reviewed_by: reviewer,
          reviewed_at: new Date().toISOString(),
          review_note: note || null,
        })
        .eq("id", pending_action_id);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    if (action === "reset") {
      // F5 (2026-10-01, see CreditPilot_Deferred_Backlog.md): previously flipped every
      // demo pending_actions row back to 'pending', regardless of status — which could
      // resurrect a stale, no-longer-applicable row (or leave it masking the fact that
      // current data wouldn't actually re-trigger it) alongside whatever cia-agent
      // inserts fresh later in the same reset sequence (initDemo.ts runs this reset
      // first, then the sensing agents, then cia-agent last). Expiring them here instead
      // clears the review queue without resurrecting anything; cia-agent's own dedup
      // (added alongside this fix) then regenerates whatever the refreshed demo data
      // actually warrants. Approved/rejected history is left alone on purpose — this only
      // clears rows a user might otherwise still see sitting in "pending".
      await supabase
        .from("pending_actions")
        .update({ status: "expired", reviewed_by: null, reviewed_at: null, review_note: null })
        .eq("is_demo", true)
        .eq("status", "pending")
        .neq("action_type", "NEW_CREDIT_LIMIT"); // onboarding proposals are not demo-reset data

      await supabase.from("agent_messages").update({ status: "pending" }).eq("is_demo", true);

      // cia-agent rebuilds its multi-signal assessments after every reset; archive the
      // previous ones (kept, not deleted) so there is one current assessment per customer.
      await supabase
        .from("credit_events")
        .update({ archived_at: new Date().toISOString() })
        .eq("is_demo", true)
        .eq("source_agent", "cia-agent")
        .in("event_type", ["COMPOSITE_RISK_CRITICAL", "COMPOSITE_RISK_ELEVATED"])
        .is("archived_at", null);

      // Put back every limit a demo approval lowered: the limit before the first
      // demo approval for that customer (credit_actions keeps it), then the seed list.
      const restore = new Map<string, number>(SEED_CREDIT_LIMITS.map(({ id, limit }) => [id, limit]));
      const { data: approvals } = await supabase
        .from("credit_actions")
        .select("customer_id, old_limit, created_at")
        .eq("performed_by", "demo_user")
        .eq("action_type", "CREDIT_LIMIT_REDUCTION")
        .not("old_limit", "is", null)
        .order("created_at", { ascending: true });
      const firstOld = new Map<string, number>();
      for (const a of approvals ?? []) if (a.customer_id && !firstOld.has(a.customer_id)) firstOld.set(a.customer_id, Number(a.old_limit));
      for (const [id, limit] of firstOld) if (!restore.has(id)) restore.set(id, limit);
      for (const [id, limit] of restore) {
        await supabase.from("customers").update({ credit_limit: limit }).eq("id", id);
      }

      await supabase
        .from("negative_news")
        .update({ reviewed: false, reviewed_by: null, reviewed_at: null })
        .eq("is_demo", true);

      // Excludes source_agent = 'cia-agent': those rows are cia-agent's OWN
      // synthesis output (DAILY_BRIEFING, COMPOSITE_RISK_CRITICAL/ELEVATED),
      // not a sensing-agent signal. Un-marking them as unprocessed here fed
      // cia-agent's own prior output back into its next run as if it were a
      // fresh signal from a new agent -- a self-reinforcing feedback loop
      // (confirmed live 2026-10-02: Ironwood Machine Works picked up
      // "cia-agent" itself as a 3rd flagging agent, escalating severity, and
      // pending-action counts grew 14 -> 20 -> 20 across repeated resets
      // instead of stabilizing). Only the 5 real sensing agents' events
      // (ar_aging_agent, news_monitor_agent, sec_monitor_agent,
      // payment_behaviour_agent, industry_risk_agent) should be marked
      // unprocessed for cia-agent to pick up fresh each reset.
      await supabase
        .from("credit_events")
        .update({ cia_processed: false, cia_processed_at: null })
        .eq("is_demo", true)
        .neq("source_agent", "cia-agent");

      const { error: invoiceDateError } = await supabase.rpc("fn_reset_demo_invoice_dates");
      if (invoiceDateError) {
        console.error("[demo-actions:reset] invoice date reset failed:", invoiceDateError.message);
      }

      const { error: paymentDateError } = await supabase.rpc("fn_reset_demo_payment_dates");
      if (paymentDateError) {
        console.error("[demo-actions:reset] payment date reset failed:", paymentDateError.message);
      }

      // Then the agents, on the server, so the replay finishes even if the visitor
      // closes the page (body.replay === false: state only, the caller runs them).
      if (body?.replay !== false) {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const pending = inBackground(replayDemoAgents(Deno.env.get("SUPABASE_URL")!, anonKey, {}, "demo-actions:reset"));
        if (pending) await pending;
        return json({ ok: true, replay: "started" });
      }
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// NEW_CREDIT_LIMIT proposals (New Customer Onboarding) need a signed-in decider,
// four-eyes and activation; they must never be approved here as "demo_user".
// deno-lint-ignore no-explicit-any
async function isNewCustomerProposal(supabase: any, id: string): Promise<boolean> {
  const { data } = await supabase.from("pending_actions").select("action_type").eq("id", id).maybeSingle();
  return data?.action_type === "NEW_CREDIT_LIMIT";
}
