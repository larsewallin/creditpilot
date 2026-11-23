import { supabase } from "@/integrations/supabase/client";

/**
 * Full demo reset + agent invocation.
 * Called by both the Reset Demo button (Actions.tsx) and the
 * session-based auto-init on first page load (App.tsx).
 */
export async function initDemo() {
  // ── 1. Reset all tables to seed state ────────────────────────────────────
  // Runs server-side via the demo-actions edge function (service role) — these
  // tables (pending_actions, agent_messages, customers, negative_news,
  // credit_events) and the invoices RPC are anon-read-only. See
  // 20260920000000_tighten_anon_write_rls.sql. The seed credit-limit values
  // now live in supabase/functions/demo-actions/index.ts.
  const { error: resetError } = await supabase.functions.invoke("demo-actions", {
    body: { action: "reset" },
  });
  if (resetError) console.error("[initDemo] reset failed:", resetError.message);

  // ── 2. Agents ─────────────────────────────────────────────────────────────
  // demo-actions runs every agent on the server after the reset (it keeps going if this
  // page closes). Wait here until CIA has proposed the actions again, at most 90 s.
  const deadline = Date.now() + 90_000;
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const { count } = await supabase.from("pending_actions").select("id", { count: "exact", head: true })
      .eq("is_demo", true).eq("status", "pending").gte("created_at", startedAt);
    if ((count ?? 0) > 0) break;
  }

  // ── 3. Mark demo as initialized ───────────────────────────────────────────

  sessionStorage.removeItem('cia_question_count');
  sessionStorage.setItem("demo_initialized", "true");
  sessionStorage.setItem("demo_activated", "true");
  sessionStorage.setItem(
    "demo_agents",
    JSON.stringify([
      "ar_aging_agent",
      "news_monitor_agent",
      "sec_monitor_agent",
      "payment_behaviour_agent",
      "industry_risk_agent",
      "credit_rating_agent",
      "country_risk_agent",
      "fx_risk_agent",
      "risk_agent",
    ])
  );
}
