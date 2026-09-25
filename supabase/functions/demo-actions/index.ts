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
 *   approve: { action: "approve", pending_action_id, action_type, customer_id,
 *              proposed_value, current_value, agent_name, rationale, note }
 *   reject:  { action: "reject", pending_action_id, note }
 *   reset:   { action: "reset" }
 *
 * Response: { ok: true } | { error: string }
 *
 * Tables written: pending_actions, customers, credit_actions, credit_events,
 *                 negative_news, agent_messages, invoices (via RPC)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

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

  try {
    const body = await req.json();
    const action = body?.action;

    if (action === "approve") {
      const {
        pending_action_id,
        action_type,
        customer_id,
        proposed_value,
        current_value,
        agent_name,
        rationale,
        note,
      } = body;

      if (!pending_action_id || !customer_id) {
        return json({ error: "Missing pending_action_id or customer_id" }, 400);
      }

      const { error: e1 } = await supabase
        .from("pending_actions")
        .update({
          status: "approved",
          reviewed_by: "demo_user",
          reviewed_at: new Date().toISOString(),
          review_note: note || null,
        })
        .eq("id", pending_action_id);
      if (e1) return json({ error: e1.message }, 500);

      if (action_type === "CREDIT_LIMIT_REDUCTION" && proposed_value != null) {
        const { error: e2 } = await supabase
          .from("customers")
          .update({ credit_limit: proposed_value })
          .eq("id", customer_id);
        if (e2) return json({ error: e2.message }, 500);
      }

      const { error: e3 } = await supabase.from("credit_actions").insert({
        customer_id,
        action_date: new Date().toISOString().split("T")[0],
        action_type,
        description: `Approved. ${note ? note + ". " : ""}${rationale ?? ""}`,
        agent_name,
        old_limit: current_value,
        new_limit: proposed_value,
        performed_by: "demo_user",
      });
      if (e3) return json({ error: e3.message }, 500);

      return json({ ok: true });
    }

    if (action === "reject") {
      const { pending_action_id, note } = body;
      if (!pending_action_id) return json({ error: "Missing pending_action_id" }, 400);

      const { error } = await supabase
        .from("pending_actions")
        .update({
          status: "rejected",
          reviewed_by: "demo_user",
          reviewed_at: new Date().toISOString(),
          review_note: note || null,
        })
        .eq("id", pending_action_id);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    if (action === "reset") {
      await supabase
        .from("pending_actions")
        .update({ status: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
        .eq("is_demo", true);

      await supabase.from("agent_messages").update({ status: "pending" }).eq("is_demo", true);

      for (const { id, limit } of SEED_CREDIT_LIMITS) {
        await supabase.from("customers").update({ credit_limit: limit }).eq("id", id);
      }

      await supabase
        .from("negative_news")
        .update({ reviewed: false, reviewed_by: null, reviewed_at: null })
        .eq("is_demo", true);

      await supabase
        .from("credit_events")
        .update({ cia_processed: false, cia_processed_at: null })
        .eq("is_demo", true);

      const { error: invoiceDateError } = await supabase.rpc("fn_reset_demo_invoice_dates");
      if (invoiceDateError) {
        console.error("[demo-actions:reset] invoice date reset failed:", invoiceDateError.message);
      }

      const { error: paymentDateError } = await supabase.rpc("fn_reset_demo_payment_dates");
      if (paymentDateError) {
        console.error("[demo-actions:reset] payment date reset failed:", paymentDateError.message);
      }

      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
