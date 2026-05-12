/**
 * Credit Intelligence Agent (CIA) — supabase/functions/cia-agent/index.ts
 *
 * Synthesises signals from all three monitoring agents into structured credit
 * intelligence. Operates in three modes selected via request body { mode }:
 *
 * briefing (default)
 *   Reads unprocessed credit_events (cia_processed = false), calls Claude Opus
 *   to produce a portfolio-wide daily briefing, writes DAILY_BRIEFING and
 *   COMPOSITE_RISK events, marks source events cia_processed = true, then
 *   runs assessCompositeRisk + calculateCreditLimitProposal for each at-risk
 *   customer and writes pending_actions for human approval.
 *   Demo: returns DEMO_BRIEFING constant; no API call.
 *
 * question
 *   Accepts { question: string }. Keyword-filters credit_events on title and
 *   description (up to 3 keywords, ilike), falls back to most recent 15 if
 *   fewer than 2 results. Calls Claude Sonnet (live) or Claude Haiku (demo).
 *   Returns { answer, sources[], confidence, confidence_reason }.
 *   Note: makes a real API call even in DEMO_MODE.
 *
 * suggestions
 *   Returns 4 suggested questions based on recent credit signals.
 *   Calls Claude Haiku (live) or returns DEMO_SUGGESTIONS (demo).
 *
 * Request body: { mode?: "briefing"|"question"|"suggestions", question?: string,
 *                 force_refresh?: boolean, customer_id?: string }
 * Response (briefing): { run_id, briefing, events_processed, stale_agents, messages }
 * Response (question): { answer, sources[], confidence, confidence_reason }
 * Response (suggestions): { suggestions: string[] }
 *
 * Tables read:  credit_events, customers, agent_runs
 * Tables written (briefing): credit_events (DAILY_BRIEFING, COMPOSITE_RISK*),
 *                             pending_actions (credit limit reductions), agent_runs
 *
 * Skills used: assessCompositeRisk, calculateCreditLimitProposal
 *
 * Credit limit decisioning: CIA agent is the sole owner of pending_actions.
 * Sensing agents (AR aging, news, SEC) write credit_events only.
 *
 * Demo mode: Controlled by DEMO_MODE=true Supabase secret.
 */
// supabase/functions/cia-agent/index.ts
// Credit Intelligence Agent (CIA) — synthesises signals from all agents into daily briefings

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.0";
import { assessCompositeRisk } from "../_shared/skills/analytical/assess-composite-risk.ts";
import { calculateCreditLimitProposal } from "../_shared/skills/analytical/calculate-credit-limit-proposal.ts";
import { aggregateCreditScores } from "../_shared/skills/analytical/aggregate-credit-scores.ts";
import { detectRatingChange } from "../_shared/skills/analytical/detect-rating-change.ts";
import { composeTeamsAlert } from "../_shared/skills/generative/compose-teams-alert.ts";
import { deliverMessage, EmailProvider, TeamsProvider, SlackProvider, LogProvider } from "../_shared/skills/integration/deliver-message.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CreditEvent {
  id: string;
  scope: string;
  customer_id: string | null;
  customer_ids: string[] | null;
  event_type: string;
  source_agent: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  signal_type: string | null;
  title: string;
  description: string | null;
  payload: Record<string, unknown>;
  credit_rating_score: number | null;
  credit_rating_raw: string | null;
  credit_rating_source: string | null;
  action_required: boolean;
  action_type: string | null;
  action_status: string | null;
  cia_processed: boolean;
  run_id: string | null;
  created_at: string;
}

interface Customer {
  id: string;
  name: string;
  ticker: string | null;
  company_type: "public" | "private" | "sme";
  credit_limit: number | null;
  current_exposure: number | null;
}

interface AgentRun {
  id: string;
  agent_name: string;
  status: string;
  completed_at: string | null;
  created_at: string;
}

interface CIARequest {
  mode?: "briefing" | "question" | "suggestions";
  question?: string;
  force_refresh?: boolean;
  customer_id?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEMO_SEED_RUN_ID = "00000099-0000-0000-0000-000000000001";

const CACHE_TTL: Record<string, number> = {
  "ar-aging-agent":  24 * 60 * 60 * 1000,
  "news-monitor-agent": 4 * 60 * 60 * 1000,
  "sec-monitor-agent": 48 * 60 * 60 * 1000,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEMO_SUGGESTIONS = [
  "Why is Triumph Group flagged across multiple agents?",
  "Which customers have the highest credit risk right now?",
  "Should I reduce Arconic's credit limit?",
  "What's my biggest portfolio exposure today?",
];

// ─── Demo Seed Data ───────────────────────────────────────────────────────────

const DEMO_BRIEFING = `## Credit Intelligence Briefing — Demo Portfolio

**Executive Summary**

Your portfolio shows elevated multi-signal risk on Triumph Group. Three independent agents have flagged this counterparty: overdue AR in the 61–90 day bucket, a covenant waiver disclosure in their latest SEC filing, and negative news coverage around liquidity concerns. This convergence of signals warrants immediate credit limit review.

**Critical Alerts (1)**

- **Triumph Group** — Multi-signal convergence: AR 61–90 days overdue ($420K), SEC covenant waiver filed, negative news sentiment HIGH. Recommended action: reduce credit limit from $1.5M to $750K pending management call.

**High Severity (3)**

- **Heliogen Inc** — Going concern warning in latest 10-K. No current AR exposure but flag for new order approvals.
- **GE Aerospace** — Credit utilization at 87% ($4.35M / $5M limit). Approaching concentration threshold.
- **Kaman Corp** — $180K overdue 31–60 days. Dunning stage 2 letter recommended.

**Macro Signal**

Aerospace & Defense sector showing stress signals across 3 of 7 monitored counterparties. Recommend sector-level credit limit review at next monthly governance meeting.

**Pending Actions Awaiting Your Approval**

3 credit limit reductions are staged and awaiting approval in the Actions panel.`;

const DEMO_MESSAGES = [
  {
    role: "assistant",
    content: DEMO_BRIEFING,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStale(lastRun: AgentRun | null, agentName: string): boolean {
  if (!lastRun?.completed_at) return true;
  const ttl = CACHE_TTL[agentName] ?? 24 * 60 * 60 * 1000;
  return Date.now() - new Date(lastRun.completed_at).getTime() > ttl;
}

function groupEventsByCustomer(events: CreditEvent[]): Record<string, CreditEvent[]> {
  const grouped: Record<string, CreditEvent[]> = {};
  for (const evt of events) {
    const key = evt.customer_id ?? "__portfolio__";
    grouped[key] = grouped[key] ?? [];
    grouped[key].push(evt);
  }
  return grouped;
}

function severityRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[s] ?? 0;
}

function buildSystemPrompt(customers: Customer[]): string {
  const customerMap = customers.map(c =>
    `- ${c.name} (id: ${c.id}, type: ${c.company_type}, credit limit: $${c.credit_limit?.toLocaleString() ?? "N/A"}, balance: $${c.current_exposure?.toLocaleString() ?? "0"})`
  ).join("\n");

  return `You are the Credit Intelligence Agent (CIA) for CreditPilot, an autonomous B2B trade credit management system.

Your role is to synthesise signals from multiple monitoring agents — AR Aging, News Monitor, and SEC Filing Monitor — into actionable credit intelligence. You think like a senior credit analyst at a trade credit insurance company.

**Portfolio customers:**
${customerMap}

**Your output format:**
1. Start with a brief executive summary (2–3 sentences).
2. List CRITICAL alerts first, then HIGH, MEDIUM.
3. For each alert: customer name, signal summary, cross-agent correlation if applicable, recommended action.
4. Highlight any customers appearing in multiple agent signals — these are highest priority.
5. End with any macro/sector observations.
6. If the user asked a specific question, answer it directly after the briefing under "## Your Question".

**Principles:**
- Be specific: cite amounts, dates, event types.
- Flag multi-signal convergence explicitly — it's the most important pattern.
- Distinguish between "act now" and "monitor closely".
- Never fabricate data; work only with the events provided.
- Keep the briefing scannable — use markdown headers and bullets.`;
}

function buildUserPrompt(
  events: CreditEvent[],
  customers: Customer[],
  question?: string
): string {
  const customerById = Object.fromEntries(customers.map(c => [c.id, c]));

  const eventSummaries = events
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .map(evt => {
      const customer = evt.customer_id ? customerById[evt.customer_id] : null;
      return [
        `[${evt.severity.toUpperCase()}] ${evt.event_type}`,
        `  Customer: ${customer?.name ?? evt.customer_id ?? "Portfolio"}`,
        `  Agent: ${evt.source_agent}`,
        `  Title: ${evt.title}`,
        evt.description ? `  Detail: ${evt.description}` : null,
        evt.credit_rating_score != null ? `  Credit score: ${evt.credit_rating_score}/100` : null,
        evt.action_required ? `  Action required: ${evt.action_type ?? "review"}` : null,
        `  Event ID: ${evt.id}`,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const parts = [
    `Here are ${events.length} unprocessed credit events from your monitoring agents:`,
    "",
    eventSummaries,
  ];

  if (question) {
    parts.push("", `## User question: ${question}`);
  }

  return parts.join("\n");
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("");
}

function sanitize(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").replace(/\r/g, "").trim();
}

// ─── Question router ─────────────────────────────────────────────────────────

// Determines which tables are relevant to a question
// Returns a set of table names to query
function routeQuestion(question: string): Set<string> {
  const q = question.toLowerCase();
  const tables = new Set<string>();

  // Always include credit_events — it's the core signal layer
  tables.add("credit_events");

  // Customer/portfolio questions
  if (/credit.?limit|exposure|utiliz|balance|customer|portfolio|company|counterpart/i.test(q))
    tables.add("customers");

  // Also add customers if the question mentions a capitalized proper noun
  // that isn't a question word or generic term (likely a company name).
  // This catches questions like 'Should I be worried about American Airlines?'
  // where no keyword matches but a specific company is named.
  const PROPER_NOUN_STOPWORDS = new Set(["What", "Which", "Who", "How", "When", "Where", "Why", "The", "Their", "And", "For", "Has", "Have", "Does", "Should", "Could", "Would", "Tell", "Show", "Give", "Get", "I"]);
  const properNouns = (question.match(/[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g) ?? [])
    .flatMap(p => p.split(/\s+/))
    .filter(w => !PROPER_NOUN_STOPWORDS.has(w) && w.length > 2);
  if (properNouns.length > 0) {
    tables.add("customers");
  }

  // AR/invoice questions
  if (/invoice|overdue|aging|ar |receivable|outstanding|bucket|days.?past|dso/i.test(q))
    tables.add("invoices");

  // Payment behaviour questions
  if (/payment|pay|late|early|behaviour|history|on.?time|dso|terms/i.test(q))
    tables.add("payment_transactions");

  // News questions
  if (/news|article|press|media|report|sentiment|negative|bloomberg|reuters/i.test(q))
    tables.add("negative_news");

  // SEC/filing questions
  if (/sec|filing|edgar|10.?k|10.?q|covenant|going.?concern|ceo|departure/i.test(q))
    tables.add("sec_filings");

  return tables;
}

// ─── Parallel data fetcher ────────────────────────────────────────────────────

interface RetrievedData {
  credit_events: any[];
  customers: any[];
  invoices: any[];
  payment_transactions: any[];
  negative_news: any[];
  sec_filings: any[];
}

async function fetchRelevantData(
  supabase: any,
  question: string,
  tables: Set<string>,
  demoMode: boolean
): Promise<RetrievedData> {

  // Extract customer name mentions from question for targeted queries
  // Strip common English words that match the capitalised-word pattern but are not company names
  const STOPWORDS = new Set(["What", "Which", "Who", "How", "When", "Where", "Why", "The", "Their", "Corporation", "Company", "Group", "Inc", "Ltd", "LLC", "Current", "Credit", "Limit", "Balance", "And", "For", "Has", "Have", "Does", "Should", "Could", "Would", "Tell", "Show", "Give", "Get"]);
  const words = (question.match(/[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g) ?? [])
    .flatMap(phrase => phrase.split(" "))
    .filter(w => !STOPWORDS.has(w) && w.length > 2);

  // Build keyword filter for text search
  const keywords = question
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/[?!.,'"]/g, ""))
    .filter(w => w.length > 4)
    .slice(0, 5);

  const results: RetrievedData = {
    credit_events: [],
    customers: [],
    invoices: [],
    payment_transactions: [],
    negative_news: [],
    sec_filings: [],
  };

  await Promise.allSettled([

    // credit_events — keyword search on title + description
    tables.has("credit_events") && (async () => {
      const orFilter = keywords.flatMap(kw => [
        `title.ilike.%${kw}%`,
        `description.ilike.%${kw}%`,
      ]).join(",");

      let q = supabase
        .from("credit_events")
        .select("id, event_type, severity, source_agent, title, description, payload, created_at, customers!left(company_name, ticker, credit_limit, current_exposure)")
        .eq("is_demo", demoMode)
        .order("created_at", { ascending: false })
        .limit(15);

      if (keywords.length > 0) {
        const { data: filtered, error: filteredErr } = await q.or(orFilter);
        if (filteredErr) console.error("credit_events filter error:", filteredErr.message);
        if (filtered && filtered.length >= 2) {
          results.credit_events = filtered;
          return;
        }
      }
      const { data: fallback, error: fallbackErr } = await q;
      if (fallbackErr) console.error("credit_events fallback error:", fallbackErr.message);
      results.credit_events = fallback ?? [];
    })(),

    // customers — search by name or return top 20 by credit_limit (highest exposure first)
    tables.has("customers") && (async () => {
      const selectFields = "id, company_name, ticker, company_type, credit_limit, current_exposure, credit_rating_score, credit_rating_raw, credit_rating_source, scenario, risk_tags, flags, payment_on_time_rate, payment_trend, payment_health";

      if (words.length > 0) {
        // Specific company names mentioned — targeted name search
        const nameFilter = words.map(w => `company_name.ilike.%${w}%`).join(",");
        const { data: named, error: namedErr } = await supabase
          .from("customers")
          .select(selectFields)
          .or(nameFilter)
          .order("company_name")
          .limit(20);
        if (namedErr) console.error("customers named error:", namedErr.message);
        // Don't fall back to full list — return whatever the name search found (even empty)
        results.customers = named ?? [];
        return;
      }
      // No names mentioned — portfolio-level question: return top 20 by credit_limit desc
      const { data, error: allErr } = await supabase
        .from("customers")
        .select(selectFields)
        .order("credit_limit", { ascending: false })
        .limit(20);
      if (allErr) console.error("customers all error:", allErr.message);
      results.customers = data ?? [];
    })(),

    // invoices — filter by customer name mention or return at-risk
    tables.has("invoices") && (async () => {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, company_name")
        .limit(20);

      const customerMap = Object.fromEntries((customers ?? []).map((c: any) => [c.id, c.company_name]));

      let custIds: string[] = [];
      if (words.length > 0) {
        custIds = (customers ?? [])
          .filter((c: any) => words.some(w => c.company_name.toLowerCase().includes(w.toLowerCase())))
          .map((c: any) => c.id);
      }

      let q = supabase
        .from("invoices")
        .select("id, invoice_number, customer_id, invoice_date, due_date, invoice_amount, outstanding_amount, status, days_overdue")
        .eq("is_demo", demoMode)
        .order("days_overdue", { ascending: false })
        .limit(20);

      if (custIds.length > 0) q = q.in("customer_id", custIds);
      else q = q.gt("days_overdue", 0);

      const { data } = await q;
      results.invoices = (data ?? []).map((inv: any) => ({
        ...inv,
        company_name: customerMap[inv.customer_id] ?? inv.customer_id,
      }));
    })(),

    // payment_transactions — recent history for mentioned customers
    tables.has("payment_transactions") && (async () => {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, company_name")
        .limit(20);

      let custIds: string[] = [];
      if (words.length > 0) {
        custIds = (customers ?? [])
          .filter((c: any) => words.some(w => c.company_name.toLowerCase().includes(w.toLowerCase())))
          .map((c: any) => c.id);
      }

      let q = supabase
        .from("payment_transactions")
        .select("customer_id, payment_date, amount_paid, days_to_pay, days_early_late, on_time, payment_method")
        .order("payment_date", { ascending: false })
        .limit(30);

      if (custIds.length > 0) q = q.in("customer_id", custIds);

      const { data } = await q;
      const customerMap = Object.fromEntries((customers ?? []).map((c: any) => [c.id, c.company_name]));
      results.payment_transactions = (data ?? []).map((p: any) => ({
        ...p,
        company_name: customerMap[p.customer_id] ?? p.customer_id,
      }));
    })(),

    // negative_news — keyword search
    tables.has("negative_news") && (async () => {
      let q = supabase
        .from("negative_news")
        .select("id, customer_id, headline, summary, source, news_date, severity, sentiment_score, category, customers!left(company_name)")
        .eq("is_demo", demoMode)
        .order("news_date", { ascending: false })
        .limit(10);

      if (keywords.length > 0) {
        const orFilter = keywords.map(kw => `headline.ilike.%${kw}%`).join(",");
        const { data: filtered } = await q.or(orFilter);
        if (filtered && filtered.length > 0) {
          results.negative_news = filtered;
          return;
        }
      }
      const { data } = await q;
      results.negative_news = data ?? [];
    })(),

    // sec_filings — most recent with risk signals
    tables.has("sec_filings") && (async () => {
      const { data } = await supabase
        .from("sec_filings")
        .select("id, customer_id, filing_type, filing_date, risk_signals, key_findings, accession_number, customers!left(company_name, ticker)")
        .eq("is_demo", demoMode)
        .order("filing_date", { ascending: false })
        .limit(10);
      results.sec_filings = data ?? [];
    })(),

  ].filter(Boolean));

  return results;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

  const jsonRes = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  let body: CIARequest = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const { mode = "briefing", question, force_refresh = false, customer_id } = body;

  // ── SUGGESTIONS mode ──────────────────────────────────────────────────────
  if (mode === "suggestions") {
    if (DEMO_MODE) {
      return jsonRes({ suggestions: DEMO_SUGGESTIONS });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Unauthorized" }, 401);

    const { data: recentEvents } = await supabaseClient
      .from("credit_events")
      .select("event_type, severity, source_agent, title, customers!left(company_name)")
      .order("created_at", { ascending: false })
      .limit(10);

    const eventsText = (recentEvents ?? []).map((e: any) =>
      `[${String(e.severity).toUpperCase()}] ${e.event_type} — ${e.title} (${e.source_agent}) — ${e.customers?.company_name ?? "Portfolio"}`
    ).join("\n");

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 200,
        system: "You are a credit analyst assistant. Given these recent credit signals, generate exactly 4 short questions a credit manager would want to ask. Return ONLY a JSON array of 4 strings, no other text.",
        messages: [{ role: "user", content: `Recent credit signals:\n${eventsText}` }],
      });

      const text = extractText(message);
      const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      const suggestions = JSON.parse(cleaned);
      return jsonRes({ suggestions });
    } catch {
      return jsonRes({ suggestions: DEMO_SUGGESTIONS });
    }
  }

  // ── QUESTION mode ──────────────────────────────────────────────────────────
  if (mode === "question") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Unauthorized" }, 401);
    if (!question) return jsonRes({ error: "question is required" }, 400);

    try {

    // Route question to relevant tables
    const tables = routeQuestion(question);

    // Fetch data from all relevant tables in parallel
    const data = await fetchRelevantData(supabaseClient, question, tables, DEMO_MODE);

    // Build context string — sanitize all text fields to prevent JSON parse errors
    // in Claude's response (quotes, backslashes, newlines in DB fields break output JSON)
    const contextParts: string[] = [];

    if (data.customers.length > 0) {
      contextParts.push("## CUSTOMERS TABLE\n" + data.customers.map((c: any) =>
        `- ${sanitize(c.company_name)} (type:${sanitize(c.company_type)}, credit_limit=$${c.credit_limit?.toLocaleString()}, balance=$${c.current_exposure?.toLocaleString()}, utilization=${c.credit_limit ? Math.round(c.current_exposure / c.credit_limit * 100) : "N/A"}%, ${c.credit_rating_score != null ? `credit_score=${c.credit_rating_score}/100 (${sanitize(c.credit_rating_raw) || "N/A"} from ${sanitize(c.credit_rating_source) || "N/A"})` : "credit_score=NR (No Rating, provider=N/A)"}, scenario=${sanitize(c.scenario) || "N/A"}, payment_health=${sanitize(c.payment_health) || "unknown"}, risk_tags=[${(c.risk_tags ?? []).map(sanitize).join(", ")}])`
      ).join("\n"));
    }

    if (data.invoices.length > 0) {
      contextParts.push("## INVOICES TABLE\n" + data.invoices.map((inv: any) =>
        `- ${sanitize(inv.company_name)}: invoice ${sanitize(inv.invoice_number)}, amount=$${inv.invoice_amount?.toLocaleString()}, outstanding=$${inv.outstanding_amount?.toLocaleString()}, due=${inv.due_date}, status=${inv.status}, days_overdue=${inv.days_overdue}`
      ).join("\n"));
    }

    if (data.payment_transactions.length > 0) {
      contextParts.push("## PAYMENT TRANSACTIONS TABLE\n" + data.payment_transactions.map((p: any) =>
        `- ${sanitize(p.company_name)}: paid $${p.amount_paid?.toLocaleString()} on ${p.payment_date}, days_to_pay=${p.days_to_pay}, days_early_late=${p.days_early_late} (${p.days_early_late > 0 ? "late" : p.days_early_late < 0 ? "early" : "on time"}), method=${p.payment_method}`
      ).join("\n"));
    }

    if (data.negative_news.length > 0) {
      contextParts.push("## NEGATIVE NEWS TABLE\n" + data.negative_news.map((n: any) =>
        `- ${sanitize(n.customers?.company_name) || "Unknown"}: ${sanitize(n.headline)} (${sanitize(n.source)}, ${n.news_date}), severity=${n.severity}, sentiment=${n.sentiment_score}`
      ).join("\n"));
    }

    if (data.sec_filings.length > 0) {
      contextParts.push("## SEC FILINGS TABLE\n" + data.sec_filings.map((f: any) =>
        `- ${sanitize(f.customers?.company_name) || "Unknown"}: ${f.filing_type} filed ${f.filing_date}, risk_signals=[${(f.risk_signals ?? []).map(sanitize).join(", ")}]`
      ).join("\n"));
    }

    if (data.credit_events.length > 0) {
      contextParts.push("## CREDIT EVENTS TABLE\n" + data.credit_events.map((e: any) =>
        `- ${sanitize(e.customers?.company_name) || "Portfolio"}: ${e.event_type} (${e.severity}) from ${e.source_agent} on ${e.created_at?.split("T")[0]} — ${sanitize(e.title)}${e.description ? ": " + sanitize(e.description) : ""}`
      ).join("\n"));
    }

    const context = contextParts.join("\n\n");

    const model = DEMO_MODE ? "claude-haiku-4-5" : "claude-sonnet-4-20250514";
    const maxTokens = DEMO_MODE ? 600 : 900;

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    try {
      // ── Call 1: plain-text answer — never embedded in JSON ──────────────────
      const answerMessage = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: `You are the Credit Intelligence Agent (CIA) for CreditPilot — a credit analyst answering questions about a B2B trade credit portfolio. Answer ONLY from the data provided. Cite every fact with its source in parentheses e.g. (customers table), (credit_events: NEGATIVE_NEWS_HIGH). Be specific with exact amounts, dates, and percentages. If data does not contain the answer say exactly: I don't have that information in the current data. Do NOT characterize a customer's relationship status (active, inactive, outside the portfolio, former, prospect, etc.) unless the data explicitly states it. Every company in the customers table is a current customer. If you don't know a customer's relationship status, don't mention it — just present the facts. Keep response under 120 words. Use markdown with **bold key terms**. Plain text output only — no JSON.`,
        messages: [{
          role: "user",
          content: `Question: ${question}\n\nData:\n${context || "No relevant data found."}`,
        }],
      });
      const answerText = extractText(answerMessage);

      // ── Call 2: structured metadata only — small JSON, no embedded answer ───
      let meta: { confidence: string; confidence_reason: string; sources: unknown[] } = {
        confidence: "Medium",
        confidence_reason: "See answer for details",
        sources: [],
      };
      try {
        const metaMessage = await anthropic.messages.create({
          model: DEMO_MODE ? "claude-haiku-4-5" : "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: `Return ONLY valid JSON, no other text. You are grading an answer about a B2B trade credit portfolio.

The grade reflects whether the answer's claims are supported by the data provided, nothing else.

- High: every specific claim in the answer (companies, scores, percentages, scenarios, risk tags, event types, dates) maps to a row in one of the provided tables. Drawing facts from multiple tables (customers + credit_events) is normal and does NOT reduce the grade. Absence of credit_events for some companies does NOT reduce the grade — no negative events on file is a positive state, not missing data.
- Medium: the answer makes at least one specific claim (an event type, an alert, a severity, a date, a name) that does not appear in any provided table.
- Low: the answer relies primarily on inference, external knowledge, or speculation rather than the data.

Do not penalize for: using multiple tables, citing credit_events when available, mentioning companies that have ratings but no credit_events, or any form of cross-table synthesis. These are all good behaviors.

Schema: {"confidence":"High|Medium|Low","confidence_reason":"one sentence stating which rubric tier applies and why","sources":[{"customer_name":"string","event_type":"string","severity":"critical|high|medium|low|info","date":"ISO date or null","agent":"string"}]}`,
          messages: [{
            role: "user",
            content: `Based on this answer and data, provide confidence and sources.\n\nAnswer: ${answerText}\n\nData:\n${context}`,
          }],
        });
        const metaText = extractText(metaMessage);
        const metaCleaned = metaText.replace(/```json/gi, "").replace(/```/g, "").trim();
        meta = JSON.parse(metaCleaned);
      } catch {
        // keep meta defaults
      }

      // ── Call 3: related questions ────────────────────────────────────────────
      let relatedQuestions = DEMO_SUGGESTIONS.slice(0, 3); // fallback
      try {
        const followUpMessage = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 150,
          system: "Generate exactly 3 short follow-up questions a credit manager would ask after reading this answer. Return ONLY a JSON array of 3 strings. Questions must be specific to the companies and issues mentioned.",
          messages: [{
            role: "user",
            content: `Answer just given: ${answerText.slice(0, 500)}\n\nGenerate 3 follow-up questions.`,
          }],
        });
        const followUpText = extractText(followUpMessage);
        const followUpCleaned = followUpText.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(followUpCleaned);
        if (Array.isArray(parsed)) relatedQuestions = parsed;
      } catch {
        // keep fallback suggestions
      }

      return jsonRes({
        answer: answerText,
        sources: meta.sources ?? [],
        confidence: meta.confidence,
        confidence_reason: meta.confidence_reason,
        relatedQuestions,
      });
    } catch (err) {
      console.error("Question mode inner error (Anthropic):", err);
      return jsonRes({ error: "Failed to generate answer" }, 500);
    }

    } catch (outerErr) {
      console.error("Question mode outer error:", outerErr instanceof Error ? outerErr.message : String(outerErr));
      return jsonRes({ error: "Question mode failed", detail: outerErr instanceof Error ? outerErr.message : String(outerErr) }, 500);
    }
  }

  // ── BRIEFING mode (default) ────────────────────────────────────────────────

  // Demo fast-path
  if (DEMO_MODE) {
    const { error: runError } = await supabaseClient
      .from("agent_runs")
      .upsert({
        id: DEMO_SEED_RUN_ID,
        agent_name: "cia-agent",
        status: "completed",
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (runError) console.error("Demo upsert error:", runError);

    return jsonRes({
      run_id: DEMO_SEED_RUN_ID,
      demo: true,
      briefing: DEMO_BRIEFING,
      events_processed: 12,
      stale_agents: [],
      messages: DEMO_MESSAGES,
    });
  }

  // Live briefing path
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonRes({ error: "Unauthorized" }, 401);
  }

  // 1. Check cache TTL per agent
  const { data: recentRuns } = await supabaseClient
    .from("agent_runs")
    .select("id, agent_name, status, completed_at, created_at")
    .in("agent_name", ["ar-aging-agent", "news-monitor-agent", "sec-monitor-agent"])
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  const latestByAgent: Record<string, AgentRun> = {};
  for (const run of (recentRuns ?? [])) {
    if (!latestByAgent[run.agent_name]) {
      latestByAgent[run.agent_name] = run;
    }
  }

  const staleAgents = Object.entries(CACHE_TTL)
    .filter(([agent]) => force_refresh || isStale(latestByAgent[agent] ?? null, agent))
    .map(([agent]) => agent);

  // 2. Read unprocessed credit_events
  let eventsQuery = supabaseClient
    .from("credit_events")
    .select("*")
    .eq("cia_processed", false)
    .eq("is_demo", DEMO_MODE)
    .order("created_at", { ascending: false })
    .limit(100);

  if (customer_id) {
    eventsQuery = eventsQuery.eq("customer_id", customer_id);
  }

  const { data: events, error: eventsError } = await eventsQuery;

  if (eventsError) {
    return jsonRes({ error: eventsError.message }, 500);
  }

  if (!events || events.length === 0) {
    return jsonRes({
      run_id: null,
      briefing: "No unprocessed credit events found. All signals are up to date.",
      events_processed: 0,
      stale_agents: staleAgents,
      messages: [],
    });
  }

  // 3. Load customer context
  const customerIds = [...new Set(events.map((e: any) => e.customer_id).filter(Boolean))] as string[];
  const { data: customers } = await supabaseClient
    .from("customers")
    .select("id, name, ticker, company_type, credit_limit, current_exposure, credit_rating_score, credit_rating_previous_score, payment_on_time_rate, payment_trend, payment_health")
    .in("id", customerIds);

  // Detect rating changes and inject as synthetic events
  const syntheticEvents: Record<string, string[]> = {};
  for (const customer of (customers ?? [])) {
    const c = customer as any;
    if (c.credit_rating_score != null && c.credit_rating_previous_score != null) {
      const change = detectRatingChange(c.credit_rating_previous_score, c.credit_rating_score);
      if (change.type === "CREDIT_RATING_DOWNGRADE" && change.action_required) {
        syntheticEvents[c.id] = syntheticEvents[c.id] ?? [];
        syntheticEvents[c.id].push("CREDIT_RATING_DOWNGRADE");
      }
    }
  }

  // 4. Call Claude
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
  const systemPrompt = buildSystemPrompt(customers ?? []);
  const userPrompt = buildUserPrompt(events as CreditEvent[], customers ?? [], question);

  let briefing = "";
  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    briefing = extractText(message);
  } catch (err) {
    console.error("Anthropic API error:", err);
    return jsonRes({ error: "Failed to generate briefing" }, 500);
  }

  // 5. Create agent_runs record
  const { data: runData, error: runError } = await supabaseClient
    .from("agent_runs")
    .insert({
      agent_name: "cia-agent",
      status: "completed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError) console.error("agent_runs insert error:", runError);
  const runId = runData?.id ?? null;

  // 6. Write CIA_ASSESSMENT events back
  const groupedEvents = groupEventsByCustomer(events as CreditEvent[]);
  const assessmentEvents = [];

  assessmentEvents.push({
    scope: "portfolio",
    customer_id: null,
    event_type: "DAILY_BRIEFING",
    source_agent: "cia-agent",
    severity: "info" as const,
    title: "Daily Credit Intelligence Briefing",
    description: briefing.slice(0, 500),
    payload: {
      full_briefing: briefing,
      events_synthesised: events.length,
      question: question ?? null,
      stale_agents: staleAgents,
    },
    action_required: false,
    is_demo: DEMO_MODE,
    cia_processed: true,
    run_id: runId,
  });

  for (const [custId, custEvents] of Object.entries(groupedEvents)) {
    if (custId === "__portfolio__") continue;
    const agentsSeen = new Set(custEvents.map((e: any) => e.source_agent));
    if (agentsSeen.size >= 2) {
      const maxSeverity = custEvents.reduce((max: string, e: any) =>
        severityRank(e.severity) > severityRank(max) ? e.severity : max,
        "info" as string
      );
      const customer = (customers ?? []).find((c: any) => c.id === custId);
      assessmentEvents.push({
        scope: "customer",
        customer_id: custId,
        event_type: maxSeverity === "critical" ? "COMPOSITE_RISK_CRITICAL" : "COMPOSITE_RISK_ELEVATED",
        source_agent: "cia-agent",
        severity: maxSeverity as "critical" | "high" | "medium" | "low" | "info",
        title: `Multi-signal risk: ${customer?.name ?? custId}`,
        description: `Signals from ${[...agentsSeen].join(", ")} — ${custEvents.length} events`,
        payload: {
          source_event_ids: custEvents.map((e: any) => e.id),
          agents: [...agentsSeen],
          event_count: custEvents.length,
        },
        action_required: maxSeverity === "critical" || maxSeverity === "high",
        action_type: maxSeverity === "critical" ? "CREDIT_LIMIT_REVIEW" : null,
        action_status: maxSeverity === "critical" ? "pending" : null,
        is_demo: DEMO_MODE,
        cia_processed: true,
        run_id: runId,
      });
    }
  }

  if (assessmentEvents.length > 0) {
    const { error: insertError } = await supabaseClient
      .from("credit_events")
      .insert(assessmentEvents);
    if (insertError) console.error("Assessment insert error:", insertError);
  }

  // 6b. Credit limit decisioning — run assessCompositeRisk + calculateCreditLimitProposal
  //     for each customer with signals, write pending_actions for human approval.
  //     Also composes and delivers a credit action alert to the credit team.

  const creditTeamEmail = Deno.env.get("CREDIT_TEAM_EMAIL") ?? "credit-team@company.com";
  const sendgridKey = Deno.env.get("SENDGRID_API_KEY") ?? "";
  const teamsWebhook = Deno.env.get("TEAMS_WEBHOOK_URL") ?? "";
  const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";

  const deliveryProviders = [
    ...(sendgridKey ? [new EmailProvider(sendgridKey)] : []),
    ...(teamsWebhook ? [new TeamsProvider(teamsWebhook)] : []),
    ...(slackWebhook ? [new SlackProvider(slackWebhook)] : []),
    new LogProvider(),
  ];

  const pendingActions = [];

  for (const [custId, custEvents] of Object.entries(groupedEvents)) {
    if (custId === "__portfolio__") continue;

    const customer = (customers ?? []).find((c: any) => c.id === custId);
    if (!customer?.credit_limit) continue;

    const agentsSeen = [...new Set(custEvents.map((e: any) => e.source_agent as string))];
    const activeEventTypes = [...new Set(custEvents.map((e: any) => e.event_type as string))];
    const activeSignalSeverities = custEvents.map((e: any) => e.severity as string);

    // Merge synthetic events detected from DB column deltas (e.g. CREDIT_RATING_DOWNGRADE)
    for (const syntheticType of (syntheticEvents[custId] ?? [])) {
      if (!activeEventTypes.includes(syntheticType)) activeEventTypes.push(syntheticType);
      activeSignalSeverities.push("high");
    }
    const creditScore: number | null = (custEvents[0] as any)?.credit_rating_score ?? null;
    const arEvent = custEvents.find((e: any) => e.payload?.utilization_pct != null) as any;
    const utilizationPct: number = arEvent?.payload?.utilization_pct ?? 0;
    const daysOver90: number = (custEvents.find((e: any) => e.payload?.buckets?.bucket_over_90 != null) as any)?.payload?.buckets?.bucket_over_90 ?? 0;
    const currentExposure: number = customer.current_exposure ?? 0;

    const onTimeRate: number | undefined = (customer as any)?.payment_on_time_rate ?? undefined;

    const riskAssessment = assessCompositeRisk({
      utilization_pct: utilizationPct,
      credit_score: creditScore,
      active_event_types: activeEventTypes,
      active_signal_severities: activeSignalSeverities,
      agents_flagging: agentsSeen,
      on_time_rate: onTimeRate,
    });

    if (!riskAssessment.recommend_action) continue;

    const proposal = calculateCreditLimitProposal({
      current_limit: customer.credit_limit,
      current_exposure: currentExposure,
      days_over_90: daysOver90,
      utilization_pct: utilizationPct,
      credit_score: creditScore,
      on_time_rate: onTimeRate,
    });

    if (proposal.action !== "reduce") continue;

    pendingActions.push({
      customer_id: custId,
      agent_name: "cia-agent",
      action_type: "CREDIT_LIMIT_REDUCTION",
      status: "pending",
      current_value: customer.credit_limit,
      proposed_value: proposal.proposed_limit,
      reduction_pct: proposal.reduction_pct,
      rationale: `${riskAssessment.rationale} ${proposal.rationale}`.trim(),
      severity: riskAssessment.severity,
      source_event_ids: custEvents.map((e: any) => e.id),
      run_id: runId,
      is_demo: DEMO_MODE,
    });

    // Compose and deliver credit action alert to credit team
    const alert = composeTeamsAlert({
      alert_type: "credit_limit_action",
      company_name: customer.name ?? custId,
      ticker: customer.ticker ?? undefined,
      severity: riskAssessment.severity === "critical" ? "critical" : "high",
      headline: `Credit limit reduction proposed: $${customer.credit_limit.toLocaleString()} → $${proposal.proposed_limit.toLocaleString()}`,
      details: riskAssessment.rationale,
      metric_label: "Proposed reduction",
      metric_value: `${proposal.reduction_pct}%`,
      recommended_action: "Review and approve or reject in the Actions page.",
    });

    await deliverMessage({
      channel: "email",
      recipient: creditTeamEmail,
      subject: alert.subject,
      body: alert.body,
    }, deliveryProviders);

    // Insert to agent_messages for audit trail
    await supabaseClient.from("agent_messages").insert({
      agent_name: "cia-agent",
      customer_id: custId,
      channel: "email",
      template_type: "credit_limit_action",
      recipient_type: "credit_committee",
      recipient_name: "Credit Risk Team",
      recipient_email: creditTeamEmail,
      subject: alert.subject,
      body: alert.body,
      status: "draft",
      is_demo: DEMO_MODE,
      run_id: runId,
    });
  }

  if (pendingActions.length > 0) {
    const { error: paError } = await supabaseClient
      .from("pending_actions")
      .insert(pendingActions);
    if (paError) console.error("pending_actions insert error:", paError);
  }

  // 6c. Write risk_tags to customers table
  //     For each customer CIA assessed, update risk_tags based on active signals.
  for (const [custId, custEvents] of Object.entries(groupedEvents)) {
    if (custId === "__portfolio__") continue;

    const agentsSeen = new Set(custEvents.map((e: any) => e.source_agent));
    const tags: string[] = [];

    // Multi-signal convergence
    if (agentsSeen.size >= 2) tags.push("MULTI_SIGNAL_RISK");
    if (agentsSeen.size >= 3) tags.push("ALL_AGENTS_FLAGGED");

    // Agent-specific signals
    const eventTypes = custEvents.map((e: any) => e.event_type);
    if (eventTypes.some((t: string) => t.includes("GOING_CONCERN")))          tags.push("GOING_CONCERN");
    if (eventTypes.some((t: string) => t.includes("COVENANT_WAIVER")))        tags.push("SEC_ALERT");
    if (eventTypes.some((t: string) => t.includes("NEGATIVE_NEWS")))          tags.push("NEGATIVE_NEWS");
    if (eventTypes.some((t: string) => t.includes("CRITICAL_UTILIZATION")))   tags.push("CRITICAL_UTILIZATION");
    if (eventTypes.some((t: string) => t.includes("HIGH_UTILIZATION")))       tags.push("HIGH_UTILIZATION");
    if (eventTypes.some((t: string) => t.includes("OVERDUE_BUCKET_OVER_90"))) tags.push("OVERDUE_90_PLUS");
    if (eventTypes.some((t: string) => t.includes("CONCENTRATION_RISK")))     tags.push("CONCENTRATION_RISK");
    if (eventTypes.some((t: string) => t.includes("CREDIT_RATING_DOWNGRADE"))) tags.push("RATING_DOWNGRADE");

    if (tags.length === 0) continue;

    await supabaseClient
      .from("customers")
      .update({ risk_tags: tags, risk_tags_updated_at: new Date().toISOString() })
      .eq("id", custId);
  }

  // 7. Mark source events as processed
  const eventIds = (events as CreditEvent[]).map(e => e.id);
  const { error: markError } = await supabaseClient
    .from("credit_events")
    .update({ cia_processed: true })
    .in("id", eventIds);

  if (markError) console.error("Mark processed error:", markError);

  return jsonRes({
    run_id: runId,
    demo: false,
    briefing,
    events_processed: events.length,
    composite_risks_detected: assessmentEvents.filter(e => e.event_type !== "DAILY_BRIEFING").length,
    pending_actions_created: pendingActions.length,
    stale_agents: staleAgents,
    messages: [{ role: "assistant", content: briefing }],
  });
});
