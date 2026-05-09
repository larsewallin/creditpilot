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

const SEED_CREDIT_LIMITS = [
  { id: "c0000001-0000-0000-0000-000000000029", limit: 3000000 },
  { id: "c0000001-0000-0000-0000-000000000008", limit: 4500000 },
  { id: "c0000001-0000-0000-0000-000000000005", limit: 5000000 },
];

const SEED_NEGATIVE_NEWS = [
  {
    id: "n0000001-0000-0000-0000-000000000001",
    customer_id: "c0000001-0000-0000-0000-000000000049", // Heliogen Inc
    headline: "Heliogen liquidity concerns mount as runway shrinks",
    summary: "Analyst report cites deteriorating cash position and risk of covenant breach in Q3.",
    source: "Reuters",
    news_date: "2026-04-19",
    category: "liquidity",
    severity: "high",
    sentiment_score: -0.78,
    reviewed: false,
    reviewed_by: null,
    reviewed_at: null,
    agent_name: "news_monitor_agent",
    is_demo: true,
  },
  {
    id: "n0000001-0000-0000-0000-000000000002",
    customer_id: "c0000001-0000-0000-0000-000000000029", // Arconic Corporation
    headline: "Arconic placed on negative watch by Moody's",
    summary: "Rating agency places Arconic on negative watch citing high leverage and slowing demand.",
    source: "Bloomberg",
    news_date: "2026-04-19",
    category: "credit_rating",
    severity: "high",
    sentiment_score: -0.65,
    reviewed: false,
    reviewed_by: null,
    reviewed_at: null,
    agent_name: "news_monitor_agent",
    is_demo: true,
  },
];

const SEED_SEC_MONITORING = [
  {
    id: "s0000001-0000-0000-0000-000000000001",
    customer_id: "c0000001-0000-0000-0000-000000000021", // Triumph Group
    cik: "1021162",
    alert_triggered: true,
    is_demo: true,
  },
  {
    id: "s0000001-0000-0000-0000-000000000002",
    customer_id: "c0000001-0000-0000-0000-000000000049", // Heliogen Inc
    cik: "1840292",
    alert_triggered: true,
    is_demo: true,
  },
];

/**
 * Full demo reset + agent invocation.
 * Called by both the Reset Demo button (Actions.tsx) and the
 * session-based auto-init on first page load (App.tsx).
 */
export async function initDemo() {
  // ── 1. Reset all tables to seed state ────────────────────────────────────

  // Reset all demo pending_actions back to pending
  await supabase
    .from("pending_actions")
    .update({ status: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
    .eq("is_demo", true);

  await supabase
    .from("agent_messages")
    .update({ status: "pending" })
    .eq("is_demo", true);

  for (const { id, limit } of SEED_CREDIT_LIMITS) {
    await supabase.from("customers").update({ credit_limit: limit }).eq("id", id);
  }

  // Delete-then-insert for sec_monitoring — avoids upsert conflict resolution issues.
  // Any agent-written rows (ai_risk_score, ai_summary) are cleared on reset by design.
  await supabase.from("sec_monitoring").delete().eq("is_demo", true);
  await supabase.from("sec_monitoring").insert(SEED_SEC_MONITORING);

  // Delete-then-insert for negative_news — avoids conflict with content_fingerprint unique index.
  // Any agent-added news rows are cleared on reset by design.
  await supabase.from("negative_news").delete().eq("is_demo", true);
  await supabase.from("negative_news").insert(SEED_NEGATIVE_NEWS);
  // Reset reviewed state on any rows not covered by the seed insert (e.g. live-mode rows)
  await supabase
    .from("negative_news")
    .update({ reviewed: false, reviewed_by: null, reviewed_at: null })
    .eq("is_demo", true);

  await supabase
    .from("credit_events")
    .update({ cia_processed: false, cia_processed_at: null })
    .eq("is_demo", true);

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
