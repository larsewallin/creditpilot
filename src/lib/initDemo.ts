import { supabase } from "@/integrations/supabase/client";

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
  },
];

const SEED_SEC_MONITORING = [
  {
    id: "s0000001-0000-0000-0000-000000000001",
    customer_id: "c0000001-0000-0000-0000-000000000021", // Triumph Group
    cik: "1021162",
    alert_triggered: true,
  },
  {
    id: "s0000001-0000-0000-0000-000000000002",
    customer_id: "c0000001-0000-0000-0000-000000000049", // Heliogen Inc
    cik: "1840292",
    alert_triggered: true,
  },
];

/**
 * Full demo reset + agent invocation.
 * Called by both the Reset Demo button (Actions.tsx) and the
 * session-based auto-init on first page load (App.tsx).
 */
export async function initDemo() {
  // ── 1. Reset all tables to seed state ────────────────────────────────────

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

  // Upsert sec_monitoring seed rows (ensures they exist), then update alert state.
  // ignoreDuplicates=true on upsert preserves ai_risk_score/ai_summary set by agents.
  await supabase.from("sec_monitoring").upsert(SEED_SEC_MONITORING, { ignoreDuplicates: true });
  await supabase
    .from("sec_monitoring")
    .update({ alert_triggered: true })
    .in("customer_id", [
      "c0000001-0000-0000-0000-000000000021",
      "c0000001-0000-0000-0000-000000000049",
    ]);

  // Upsert negative_news seed rows (ensures they exist and resets reviewed state),
  // then reset reviewed state on any additional rows added by the agent.
  await supabase.from("negative_news").upsert(SEED_NEGATIVE_NEWS);
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
