import { supabase } from "@/integrations/supabase/client";

// All 5 seed pending_actions — exact values from migrations.
// Rows 1-3: 20260419220602_demo_seed_data.sql (agent updated to cia-agent by 20260429000000)
// Rows 4-5: 20260429000002_private_sme_customers.sql
const SEED_PENDING_ACTIONS = [
  {
    id: 'a0000001-0000-0000-0000-000000000001',
    run_id: '0aa07788-5801-48ad-b070-384389296dee',
    customer_id: 'c0000001-0000-0000-0000-000000000029', // Arconic Corporation
    agent_name: 'cia-agent',
    action_type: 'CREDIT_LIMIT_REDUCTION',
    rationale: 'Critical utilization (91.7%) with deteriorating payment behaviour. Limit reduction to protect exposure.',
    current_value: 3000000,
    proposed_value: 2250000,
    status: 'pending',
    is_demo: true,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  },
  {
    id: 'a0000001-0000-0000-0000-000000000002',
    run_id: '0aa07788-5801-48ad-b070-384389296dee',
    customer_id: 'c0000001-0000-0000-0000-000000000008', // Howmet Aerospace
    agent_name: 'cia-agent',
    action_type: 'CREDIT_LIMIT_REDUCTION',
    rationale: 'High utilization (71.1%) combined with concern-range credit score and declining on-time payment rate.',
    current_value: 4500000,
    proposed_value: 3375000,
    status: 'pending',
    is_demo: true,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  },
  {
    id: 'a0000001-0000-0000-0000-000000000003',
    run_id: '0aa07788-5801-48ad-b070-384389296dee',
    customer_id: 'c0000001-0000-0000-0000-000000000005', // Precision Castparts
    agent_name: 'cia-agent',
    action_type: 'CREDIT_LIMIT_REDUCTION',
    rationale: 'Elevated utilization (76%) with concentration risk (8.2% of portfolio). Proactive limit reduction recommended.',
    current_value: 5000000,
    proposed_value: 3750000,
    status: 'pending',
    is_demo: true,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  },
  {
    id: 'a0000002-0000-0000-0000-000000000001',
    run_id: '0bb08899-6912-0000-0001-000000000000',
    customer_id: 'c0000002-0000-0000-0000-000000000001', // Atlas Precision Manufacturing
    agent_name: 'cia-agent',
    action_type: 'CREDIT_LIMIT_REDUCTION',
    rationale: 'High utilization (80%) combined with negative news on cash flow and consistently late payment behaviour (avg 18 days late). Limit reduction recommended to reduce exposure.',
    current_value: 1500000,
    proposed_value: 1100000,
    status: 'pending',
    is_demo: true,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  },
  {
    id: 'a0000002-0000-0000-0000-000000000002',
    run_id: '0bb08899-6912-0000-0001-000000000000',
    customer_id: 'c0000002-0000-0000-0000-000000000009', // Ironwood Machine Works
    agent_name: 'cia-agent',
    action_type: 'CREDIT_LIMIT_REDUCTION',
    rationale: 'Critical utilization (92.5%) with two overdue invoices and worsening payment behaviour. Proactive limit reduction to cap exposure at current outstanding level.',
    current_value: 200000,
    proposed_value: 150000,
    status: 'pending',
    is_demo: true,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  },
];

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

  // ── 2. Invoke all agents ──────────────────────────────────────────────────

  await Promise.all([
    supabase.functions.invoke("ar-aging-agent", { body: { triggered_by: "auto" } }),
    supabase.functions.invoke("news-monitor-agent", { body: { triggered_by: "auto" } }),
    supabase.functions.invoke("sec-monitor-agent", { body: { triggered_by: "auto" } }),
  ]);
  await supabase.functions.invoke("cia-agent", { body: {} });

  // ── 3. Mark demo as initialized ───────────────────────────────────────────

  sessionStorage.removeItem('cia_question_count');
  sessionStorage.setItem("demo_initialized", "true");
  sessionStorage.setItem("demo_activated", "true");
  sessionStorage.setItem(
    "demo_agents",
    JSON.stringify(["ar_aging_agent", "news_monitor_agent", "sec_monitor_agent"])
  );
}
