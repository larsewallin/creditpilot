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
 *   approve: { action: "approve", pending_action_id, note, approved_value? }
 *            Demo: the stored proposal's value, always. Production: the approver may set another
 *            amount (with a note); a limit above the current one needs approval authority for it
 *            (policy.approvals); above it, the approver's amount is recorded as a recommendation.
 *   reject:  { action: "reject", pending_action_id, note }
 *   reset:   { action: "reset" }
 *
 * Response: { ok: true } | { error: string }
 *
 * Production (DEMO_MODE not "true"): approve / reject need a signed-in admin, credit manager or
 * credit analyst; reset answers 404.
 *
 * Tables written: pending_actions, customers, credit_actions, credit_events,
 *                 negative_news, agent_messages, invoices (via RPC)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { AuthError, requireUser, type AuthedUser } from "../_shared/auth.ts";
import { loadPolicy } from "../_shared/policy/policy.ts";
import { authorityOf, authorityText, mayApprove } from "../_shared/policy/authority.ts";
import { inBackground, replayDemoAgents } from "../_shared/demo_replay.ts";
import { rebuildDemo } from "../_shared/demo/rebuild.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    let approver: AuthedUser | null = null;
    if (!DEMO && action === "reset") return json({ error: "Not found" }, 404);
    // Demo: a signed-in persona decides by its role (a sales rep looks around); a visitor who
    // is not signed in may still try it (founder 2026-11-17 / 2026-11-21).
    if (DEMO && (action === "approve" || action === "reject")) {
      const signedIn = await requireUser(req).catch(() => null);
      if (signedIn && !["admin", "credit_manager", "credit_analyst"].includes(signedIn.role)) {
        return json({ error: "Sales and viewers don't approve or reject: a credit analyst or manager decides." }, 403);
      }
      if (signedIn) reviewer = signedIn.display_name ?? signedIn.email;
    }
    if (!DEMO && (action === "approve" || action === "reject")) {
      // Production: a signed-in admin or credit manager, recorded under their name.
      // Demo (by design, founder 2026-11-17): anyone may try approving or rejecting; the
      // values always come from the stored proposal, and Reset Demo / the daily refresh
      // put everything back.
      try {
        const u = await requireUser(req, ["admin", "credit_manager", "credit_analyst"]);
        reviewer = u.email;
        approver = u;
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
        .select("id, status, is_demo, action_type, customer_id, current_value, proposed_value, agent_name, rationale, escalated_value, recommended_note")
        .eq("id", pending_action_id)
        .maybeSingle();
      if (e0) return json({ error: e0.message }, 500);
      if (!pa || pa.is_demo !== DEMO) return json({ error: "Unknown action" }, 404);
      if (pa.action_type === "NEW_CREDIT_LIMIT") {
        return json({ error: "New-customer limits are decided through onboarding (signed-in credit manager)" }, 400);
      }
      if (pa.status !== "pending") return json({ error: `This action is already ${pa.status}` }, 409);

      // The amount: the stored proposal, or in production an approver's own amount with a note.
      let newLimit: number | null = pa.proposed_value;
      if (approver && body.approved_value != null && pa.action_type === "CREDIT_LIMIT_REDUCTION") {
        const v = Math.round(Number(body.approved_value));
        if (!Number.isFinite(v) || v < 0) return json({ error: "approved_value must be an amount of 0 or more" }, 400);
        const acceptsEscalation = pa.escalated_value != null && v === Number(pa.escalated_value) && !!pa.recommended_note;
        if (v !== Number(pa.proposed_value) && String(note ?? "").trim().length < 10 && !acceptsEscalation) {
          return json({ error: "A note is required when the amount differs from the proposal" }, 400);
        }
        newLimit = v;
      }
      // Approval authority: a cut needs none; a limit above the current one needs authority for it.
      if (approver && newLimit != null) {
        const { policy } = await loadPolicy(supabase);
        if (!mayApprove(approver, policy, newLimit, Number(pa.current_value) || 0)) {
          await supabase.from("pending_actions").update({ recommended_by_user: approver.user_id, recommended_by: approver.display_name,
            escalated_value: newLimit, recommended_note: note || null, recommended_at: new Date().toISOString() }).eq("id", pending_action_id);
          return json({ ok: true, decision: "recommended",
            message: `Recommended at ${newLimit.toLocaleString("en-US")} USD. That is above your approval authority (${authorityText(authorityOf(approver, policy))}), so it waits for someone whose authority covers it.` });
        }
      }

      const { error: e1 } = await supabase
        .from("pending_actions")
        .update({
          status: "approved",
          reviewed_by: reviewer,
          reviewed_at: new Date().toISOString(),
          review_note: note || null,
          decided_value: newLimit,
          ...(approver ? { reviewed_by_user: approver.user_id } : {}),
        })
        .eq("id", pending_action_id)
        .eq("status", "pending");
      if (e1) return json({ error: e1.message }, 500);

      if (pa.action_type === "CREDIT_LIMIT_REDUCTION" && newLimit != null && pa.customer_id) {
        const { error: e2 } = await supabase
          .from("customers")
          .update({ credit_limit: newLimit })
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
        new_limit: newLimit,
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
      // Rebuild the demo from the story table for today (founder 2026-11-22, the demo data rewrite):
      // every demo row deleted and written again, nothing rolled forward, so every page agrees and
      // the demo looks the same any day. The agents then run on it (below).
      const rebuilt = await rebuildDemo(supabase, new Date());
      console.log("[demo-actions:reset] rebuilt", JSON.stringify(rebuilt));

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
