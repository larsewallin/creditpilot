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
  company_name: string;
  company_type: "public" | "private" | "sme";
  credit_limit: number | null;
  current_exposure: number | null;
}

interface AgentRun {
  id: string;
  agent_name: string;
  status: string;
  completed_at: string | null;
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
    `- ${c.company_name} (id: ${c.id}, type: ${c.company_type}, credit limit: $${c.credit_limit?.toLocaleString() ?? "N/A"}, balance: $${c.current_exposure?.toLocaleString() ?? "0"})`
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
        `  Customer: ${customer?.company_name ?? evt.customer_id ?? "Portfolio"}`,
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

// Marker the model is instructed to emit (alone, on its own line) instead of
// freely naming customers/percentages/a count itself when a question calls for
// the complete high-utilization list — both are well-documented LLM weaknesses
// at this scale. Replaced post-generation with a deterministically-built block
// from the same highUtilizationLines array already used for the context section,
// including real citation tags, before the existing tag verification/stripping
// pipeline runs (so it flows through unmodified, see buildHighUtilizationListBlock).
const HIGH_UTIL_MARKER_TEST = /\{\{\s*HIGH_UTILIZATION_LIST\s*\}\}/;
const HIGH_UTIL_MARKER_REPLACE = /\{\{\s*HIGH_UTILIZATION_LIST\s*\}\}/g;

function buildHighUtilizationListBlock(
  lines: { tag: string; company_name: string | null; credit_limit: number | null; current_exposure: number | null }[]
): string {
  if (lines.length === 0) {
    return "**No customers** are currently at or above 85% utilization.";
  }
  const bullets = lines.map((c) => {
    const utilPct = Math.round(((c.current_exposure as number) / (c.credit_limit as number)) * 100);
    return `- **${sanitize(c.company_name)}** — ${utilPct}% utilization (balance $${c.current_exposure?.toLocaleString()}, credit limit $${c.credit_limit?.toLocaleString()}) [${c.tag}]`;
  }).join("\n");
  return `**${lines.length} customer${lines.length === 1 ? "" : "s"}** at or above 85% utilization:\n${bullets}`;
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

// ─── LLM-based question entity extraction ────────────────────────────────────
// Replaces routeQuestion's regex table-detection and fetchRelevantData's regex
// proper-noun/sector extraction as the primary path. Both are English-only and
// structurally can't handle other languages (German capitalizes every common
// noun; French/Spanish diacritics fall outside [A-Za-z] and truncate names).
// The old regex logic is preserved below as regexFallbackExtraction, used only
// if this call fails or returns malformed output — never a hard failure.

interface QuestionExtraction {
  company_mentions: string[];
  sector: string | null;
  tables: Set<string>;
}

const CANONICAL_SECTORS = new Set([
  "Aerospace & Defense", "Energy", "Industrial Manufacturing",
  "Materials", "Transportation", "Mining", "Other",
]);

const KNOWN_TABLES = new Set([
  "credit_events", "customers", "invoices", "payment_transactions", "negative_news", "sec_filings",
]);

// Pre-LLM regex logic, preserved as the fallback path (not deleted). Mirrors
// routeQuestion's table detection plus fetchRelevantData's former proper-noun
// and SECTOR_KEYWORDS extraction, so a failed extraction call degrades to
// exactly today's behavior rather than failing the question outright.
function regexFallbackExtraction(question: string): QuestionExtraction {
  const tables = routeQuestion(question);

  const STOPWORDS = new Set(["What", "Which", "Who", "How", "When", "Where", "Why", "The", "Their", "Corporation", "Company", "Group", "Inc", "Ltd", "LLC", "Current", "Credit", "Limit", "Balance", "And", "For", "Has", "Have", "Does", "Should", "Could", "Would", "Tell", "Show", "Give", "Get"]);
  const company_mentions = (question.match(/[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g) ?? [])
    .flatMap(phrase => phrase.split(" "))
    .filter(w => !STOPWORDS.has(w) && w.length > 2);

  const SECTOR_KEYWORDS: Record<string, string[]> = {
    'Aerospace & Defense': ['aerospace', 'aviation', 'defense', 'naval', 'airline', 'aircraft', 'space'],
    'Energy': ['energy', 'power', 'oil', 'gas', 'petroleum', 'solar', 'fuel cell'],
    'Industrial Manufacturing': ['industrial', 'manufacturing', 'precision', 'engineering', 'machinery'],
    'Materials': ['materials', 'metal', 'aluminum', 'alloy', 'coating', 'fabrication'],
    'Transportation': ['transportation', 'freight', 'trucking', 'transit'],
    'Mining': ['mining'],
  };
  const qLower = question.toLowerCase();
  const detectedSector = Object.entries(SECTOR_KEYWORDS).find(([_, kws]) =>
    kws.some(kw => qLower.includes(kw))
  );

  return {
    company_mentions,
    sector: detectedSector ? detectedSector[0] : null,
    tables,
  };
}

// Validates/sanitizes the LLM extraction call's parsed JSON before it's trusted —
// unknown table names or non-canonical sector values are dropped rather than
// passed through, since downstream code (the sector .eq() filter, table Set
// lookups) assumes only known values ever appear. Throws on a fundamentally
// malformed shape so the caller falls back to regex rather than trusting garbage.
function validateExtraction(parsed: any): QuestionExtraction {
  if (!parsed || typeof parsed !== "object") throw new Error("extraction result is not an object");

  const company_mentions = Array.isArray(parsed.company_mentions)
    ? parsed.company_mentions
        .filter((m: unknown): m is string => typeof m === "string" && m.trim().length > 0)
        .map((m: string) => m.trim())
    : [];

  const sector = typeof parsed.sector === "string" && CANONICAL_SECTORS.has(parsed.sector)
    ? parsed.sector
    : null;

  const tables = new Set<string>(
    Array.isArray(parsed.tables)
      ? parsed.tables.filter((t: unknown): t is string => typeof t === "string" && KNOWN_TABLES.has(t))
      : []
  );
  tables.add("credit_events"); // always included, matches existing routeQuestion behavior

  return { company_mentions, sector, tables };
}

// Primary extraction path: one Haiku call resolves table routing, company name
// mentions, and sector — replacing the regex table detection, proper-noun checks,
// and SECTOR_KEYWORDS matching with a single language-agnostic pass. Always
// resolves (never throws) — falls back to the exact prior regex behavior on any
// failure, so a bad extraction degrades gracefully rather than failing the question.
async function extractQuestionEntities(anthropic: Anthropic, question: string): Promise<QuestionExtraction> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: `Extract structured routing information from a credit analyst's question about a B2B trade credit portfolio. Return ONLY valid JSON, no other text, matching exactly this schema:
{"company_mentions": string[], "sector": string|null, "tables": string[]}

- company_mentions: the raw company name fragment(s) mentioned in the question, exactly as they appear or are clearly implied (e.g. "Cascade's" -> "Cascade", "l'entreprise Cascade" -> "Cascade"). Do NOT resolve to a canonical/official company name — just extract the mentioned fragment; a separate database search handles fuzzy matching against real records. Empty array if no company is named.
- sector: exactly one of these 7 values if the question refers to an industry/sector broadly rather than one named company: "Aerospace & Defense", "Energy", "Industrial Manufacturing", "Materials", "Transportation", "Mining", "Other". Use null if no sector is referenced.
- tables: which of these 6 table names are relevant to answering the question: "credit_events", "customers", "invoices", "payment_transactions", "negative_news", "sec_filings". Include "customers" whenever a specific company or a sector is mentioned. Include every table genuinely relevant, not just one. Always include at least one table.

The question may be in any language — extract meaning and intent, not just English keyword matches.`,
      messages: [{ role: "user", content: question }],
    });
    const text = extractText(message);
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const jsonSlice = firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
    return validateExtraction(JSON.parse(jsonSlice));
  } catch (err) {
    console.error("[cia-agent] question extraction failed, falling back to regex:", (err as Error).message);
    return regexFallbackExtraction(question);
  }
}

// ─── Parallel data fetcher ────────────────────────────────────────────────────

interface RetrievedData {
  credit_events: any[];
  credit_events_matched: any[];
  multi_signal_convergence: any[] | null;
  negative_news_matched: any[];
  sec_filings_matched: any[];
  customers: any[];
  customers_combined_total: { count: number; company_names: string[]; total_credit_limit: number; total_current_exposure: number } | null;
  customers_sector_total: { sector: string; count: number; total_credit_limit: number; total_current_exposure: number } | null;
  invoices: any[];
  ar_aging_portfolio_summary: any | null;
  ar_aging_customer_summary: any[] | null;
  ar_aging_sector_summary: { sector: string; count: number; total_current: number; total_1_30: number; total_31_60: number; total_61_90: number; total_over_90: number; total_pre_petition: number; total_outstanding: number; current_count: number; bucket_1_30_count: number; bucket_31_60_count: number; bucket_61_90_count: number; bucket_over_90_count: number } | null;
  payment_transactions: any[];
  payment_behavior_summary: any[] | null;
  payment_behavior_sector_summary: { sector: string; count: number; total_payments: number; total_paid_all_time: number; avg_days_to_pay: number | null; avg_days_early_late: number | null; on_time_payment_pct: number | null } | null;
  payment_behavior_portfolio_summary: any | null;
  negative_news: any[];
  sec_filings: any[];
}

// Lookup entry for a single tagged record ([C3], [E1], etc.) built while assembling
// contextParts, used to mechanically verify which tags the model actually cites.
interface TagLookupEntry {
  table: "customers" | "invoices" | "payment_transactions" | "negative_news" | "sec_filings" | "credit_events";
  id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  event_type: string | null;
  severity: string | null;
  date: string | null;
  agent: string | null;
}

async function fetchRelevantData(
  supabase: any,
  question: string,
  tables: Set<string>,
  demoMode: boolean,
  companyMentions: string[],
  sector: string | null
): Promise<RetrievedData> {

  // Generic question-scaffolding words that match event text noisily without
  // discriminating — exclude from keyword search (domain terms like "negative",
  // "overdue", "utilization", "bankruptcy" are deliberately NOT here).
  const KEYWORD_STOPLIST = new Set([
    "customer", "customers", "company", "companies", "account", "accounts",
    "portfolio", "recent", "recently", "current", "currently", "about",
    "their", "there", "would", "should", "could", "right", "have", "having",
    "which", "where", "these", "those", "still", "being", "across",
    "group", "corporation", "incorporated", "holdings", "holding",
    "industries", "international", "systems", "technologies", "solutions",
  ]);

  // Build keyword filter for text search
  const keywords = question
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/'s$/, "").replace(/[?!.,'"]/g, ""))
    .filter(w => w.length > 4 && !KEYWORD_STOPLIST.has(w))
    .slice(0, 5);

  const results: RetrievedData = {
    credit_events: [],
    credit_events_matched: [],
    multi_signal_convergence: null,
    negative_news_matched: [],
    sec_filings_matched: [],
    customers: [],
    customers_combined_total: null,
    customers_sector_total: null,
    invoices: [],
    ar_aging_portfolio_summary: null,
    ar_aging_customer_summary: null,
    ar_aging_sector_summary: null,
    payment_transactions: [],
    payment_behavior_summary: null,
    payment_behavior_sector_summary: null,
    payment_behavior_portfolio_summary: null,
    negative_news: [],
    sec_filings: [],
  };

  await Promise.allSettled([

    // credit_events — keyword search on title + description, plus the deterministic
    // multi-signal convergence RPC fired in parallel (same 90-day window, see
    // fn_multi_signal_convergence — GROUP BY + HAVING is correct at any table size,
    // unlike inferring convergence from this keyword/fallback query's own row cap).
    tables.has("credit_events") && (async () => {
      const ninetyDaysAgoISOString = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      const orFilter = keywords.flatMap(kw => [
        `title.ilike.%${kw}%`,
        `description.ilike.%${kw}%`,
      ]).join(",");

      const baseQuery = () => supabase
        .from("credit_events")
        .select("id, customer_id, event_type, severity, source_agent, title, description, payload, created_at, customers!left(company_name, credit_limit, current_exposure)")
        .eq("is_demo", demoMode)
        .gte("created_at", ninetyDaysAgoISOString)
        .order("severity_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(300);

      const [creditEventsResult, convergenceResult] = await Promise.all([
        (async () => {
          if (keywords.length > 0) {
            const { data: filtered, error: filteredErr } = await baseQuery().or(orFilter);
            if (filteredErr) console.error("credit_events filter error:", filteredErr.message);
            if (filtered && filtered.length >= 2) {
              // Genuinely keyword-matched events — these are the attributable sources.
              return { matched: filtered, events: filtered };
            }
          }
          const { data: fallback, error: fallbackErr } = await baseQuery();
          if (fallbackErr) console.error("credit_events fallback error:", fallbackErr.message);
          return { matched: null as any[] | null, events: fallback ?? [] };
        })(),
        supabase.rpc("fn_multi_signal_convergence", { p_is_demo: demoMode }),
      ]);

      if (creditEventsResult.matched) {
        results.credit_events_matched = creditEventsResult.matched;
      }
      results.credit_events = creditEventsResult.events;

      const { data: convergenceData, error: convergenceErr } = convergenceResult;
      if (convergenceErr) console.error("fn_multi_signal_convergence error:", convergenceErr.message);
      results.multi_signal_convergence = convergenceData ?? null;
    })(),

    // customers — search by name or return top 20 by credit_limit (highest exposure first)
    tables.has("customers") && (async () => {
      const selectFields = "id, company_name, company_type, credit_limit, current_exposure, credit_rating_score, credit_rating_raw, credit_rating_source, scenario, risk_tags, payment_on_time_rate, payment_trend, payment_health";

      if (companyMentions.length > 0) {
        // Specific company names mentioned — targeted name search
        const nameFilter = companyMentions.map(w => `company_name.ilike.%${w}%`).join(",");
        const { data: named, error: namedErr } = await supabase
          .from("customers")
          .select(selectFields)
          .or(nameFilter)
          .order("company_name")
          .limit(20);
        if (namedErr) console.error("customers named error:", namedErr.message);
        // Don't fall back to full list — return whatever the name search found (even empty)
        results.customers = named ?? [];
        if ((named ?? []).length >= 2) {
          // Multiple named companies matched: pre-compute their combined total so the
          // model doesn't have to sum raw balances across them itself.
          results.customers_combined_total = {
            count: named!.length,
            company_names: named!.map((c: any) => c.company_name),
            total_credit_limit: named!.reduce((sum: number, c: any) => sum + (c.credit_limit ?? 0), 0),
            total_current_exposure: named!.reduce((sum: number, c: any) => sum + (c.current_exposure ?? 0), 0),
          };
        }
        return;
      }

      if (sector) {
        const { data, error } = await supabase
          .from('customers')
          .select(selectFields)
          .eq('sector', sector)
          .order('credit_limit', { ascending: false })
          .limit(50);
        if (error) console.error('sector filter error:', error.message);
        results.customers = data ?? [];
        if ((data ?? []).length > 0) {
          // Pre-compute the sector's combined total so the model doesn't have to
          // sum raw balances across up to 50 returned customers itself.
          results.customers_sector_total = {
            sector,
            count: data!.length,
            total_credit_limit: data!.reduce((sum: number, c: any) => sum + (c.credit_limit ?? 0), 0),
            total_current_exposure: data!.reduce((sum: number, c: any) => sum + (c.current_exposure ?? 0), 0),
          };
        }
      } else {
        // Portfolio-level question — return risk-ranked customers (V1 rule, B5).
        // fn_rank_portfolio_risk: high-risk set first, then remaining by exposure.
        // Previously LIMIT 25'd (missing ~34 of 59 customers) — removed in
        // migration 20260902000000, so this is now the complete customer set,
        // same as the named/sector branches. The separate minimal-column
        // utilization scan that used to compensate for that gap is no longer
        // needed and has been removed.
        const { data, error } = await supabase.rpc('fn_rank_portfolio_risk');
        if (error) console.error('portfolio risk ranking error:', error.message);
        results.customers = data ?? [];
      }
    })(),

    // invoices — filter by customer name mention or return at-risk
    tables.has("invoices") && (async () => {
      let custIds: string[] = [];
      let custIdSource: "named" | "sector" | "none" = "none";
      if (companyMentions.length > 0) {
        const nameFilter = companyMentions.map(w => `company_name.ilike.%${w}%`).join(",");
        const { data: matched, error: matchedErr } = await supabase
          .from("customers")
          .select("id")
          .or(nameFilter);
        if (matchedErr) console.error("customers matched error:", matchedErr.message);
        custIds = (matched ?? []).map((c: any) => c.id);
        custIdSource = "named";
      } else if (sector) {
        // Sector-wide question (no named company): scope invoices to the sector's
        // customers instead of falling through to the fully portfolio-wide branch —
        // previously this branch had no sector awareness at all.
        const { data: sectorMatched, error: sectorMatchedErr } = await supabase
          .from("customers")
          .select("id")
          .eq("sector", sector);
        if (sectorMatchedErr) console.error("customers sector-match error:", sectorMatchedErr.message);
        custIds = (sectorMatched ?? []).map((c: any) => c.id);
        custIdSource = "sector";
      }

      const todayStr = new Date().toISOString().split("T")[0];
      let q = supabase
        .from("invoices")
        .select("id, invoice_number, customer_id, invoice_date, due_date, invoice_amount, outstanding_amount, status, days_overdue")
        .order("due_date", { ascending: true })
        .limit(20);

      if (custIds.length > 0) {
        q = q.in("customer_id", custIds);

        // Named customer(s) or sector: also fetch pre-computed, deterministic
        // per-customer aggregate totals — the raw invoice line items above are
        // unreliable for the model to sum itself across potentially many records.
        const { data: customerSummary, error: customerSummaryErr } = await supabase
          .from("v_ar_aging_current")
          .select("customer_id, company_name, current_amount, bucket_1_30, bucket_31_60, bucket_61_90, bucket_over_90, pre_petition_amount, total_outstanding, utilization_pct, risk_tier, credit_limit, total_invoice_count, current_count, bucket_1_30_count, bucket_31_60_count, bucket_61_90_count, bucket_over_90_count")
          .in("customer_id", custIds);
        if (customerSummaryErr) console.error("v_ar_aging_current query error:", customerSummaryErr.message);
        results.ar_aging_customer_summary = customerSummary ?? null;

        if (custIdSource === "sector" && customerSummary && customerSummary.length > 0) {
          // Sector-wide (not a named company): also pre-compute the summed sector
          // total from the per-customer rows just fetched — otherwise the model
          // would still have to sum up to 50 pre-computed rows itself.
          results.ar_aging_sector_summary = {
            sector: sector!,
            count: customerSummary.length,
            total_current: customerSummary.reduce((sum: number, c: any) => sum + (c.current_amount ?? 0), 0),
            total_1_30: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_1_30 ?? 0), 0),
            total_31_60: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_31_60 ?? 0), 0),
            total_61_90: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_61_90 ?? 0), 0),
            total_over_90: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_over_90 ?? 0), 0),
            total_pre_petition: customerSummary.reduce((sum: number, c: any) => sum + (c.pre_petition_amount ?? 0), 0),
            total_outstanding: customerSummary.reduce((sum: number, c: any) => sum + (c.total_outstanding ?? 0), 0),
            current_count: customerSummary.reduce((sum: number, c: any) => sum + (c.current_count ?? 0), 0),
            bucket_1_30_count: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_1_30_count ?? 0), 0),
            bucket_31_60_count: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_31_60_count ?? 0), 0),
            bucket_61_90_count: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_61_90_count ?? 0), 0),
            bucket_over_90_count: customerSummary.reduce((sum: number, c: any) => sum + (c.bucket_over_90_count ?? 0), 0),
          };
        }
      } else {
        q = q.lt("due_date", todayStr).not("status", "in", "(paid,written_off)");

        // Portfolio-wide question (no named customer): also fetch pre-computed,
        // deterministic aggregate totals — the raw invoice line items above are
        // unreliable for the model to sum itself across many records.
        const { data: portfolioSummary, error: portfolioSummaryErr } = await supabase
          .from("v_ar_aging_portfolio")
          .select("*")
          .single();
        if (portfolioSummaryErr) console.error("v_ar_aging_portfolio query error:", portfolioSummaryErr.message);
        results.ar_aging_portfolio_summary = portfolioSummary ?? null;
      }

      const { data } = await q;

      const resultCustIds = [...new Set((data ?? []).map((inv: any) => inv.customer_id))];
      let customerMap: Record<string, string> = {};
      if (resultCustIds.length > 0) {
        const { data: custData, error: custDataErr } = await supabase
          .from("customers")
          .select("id, company_name")
          .in("id", resultCustIds);
        if (custDataErr) console.error("customers lookup error:", custDataErr.message);
        customerMap = Object.fromEntries((custData ?? []).map((c: any) => [c.id, c.company_name]));
      }

      const today = new Date(todayStr + "T00:00:00Z");
      results.invoices = (data ?? []).map((inv: any) => {
        const dueDate = new Date(inv.due_date + "T00:00:00Z");
        const liveDaysOverdue = Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / 86400000));
        const liveStatus = (inv.status === "current" || inv.status === "overdue")
          ? (liveDaysOverdue > 0 ? "overdue" : "current")
          : inv.status;
        return {
          ...inv,
          days_overdue: liveDaysOverdue,
          status: liveStatus,
          company_name: customerMap[inv.customer_id] ?? inv.customer_id,
        };
      });
    })(),

    // payment_transactions — recent history for mentioned customers
    tables.has("payment_transactions") && (async () => {
      let custIds: string[] = [];
      let custIdSource: "named" | "sector" | "none" = "none";
      if (companyMentions.length > 0) {
        const nameFilter = companyMentions.map(w => `company_name.ilike.%${w}%`).join(",");
        const { data: matched, error: matchedErr } = await supabase
          .from("customers")
          .select("id")
          .or(nameFilter);
        if (matchedErr) console.error("customers matched error:", matchedErr.message);
        custIds = (matched ?? []).map((c: any) => c.id);
        custIdSource = "named";
      } else if (sector) {
        // Sector-wide question (no named company): scope payment history to the
        // sector's customers instead of the fully portfolio-wide branch — previously
        // this branch had no sector awareness at all.
        const { data: sectorMatched, error: sectorMatchedErr } = await supabase
          .from("customers")
          .select("id")
          .eq("sector", sector);
        if (sectorMatchedErr) console.error("customers sector-match error:", sectorMatchedErr.message);
        custIds = (sectorMatched ?? []).map((c: any) => c.id);
        custIdSource = "sector";
      }

      let q = supabase
        .from("payment_transactions")
        .select("customer_id, payment_date, amount_paid, days_to_pay, days_early_late, on_time, payment_method")
        .order("payment_date", { ascending: false })
        .limit(30);

      if (custIds.length > 0) {
        q = q.in("customer_id", custIds);

        // Named customer(s) or sector: also fetch pre-computed, deterministic
        // payment-behaviour aggregates — averaging/summing the raw transactions
        // below is unreliable.
        const { data: behaviorSummary, error: behaviorSummaryErr } = await supabase
          .from("v_payment_behaviour")
          .select("customer_id, company_name, total_payments, total_paid_all_time, avg_days_to_pay, avg_days_early_late, on_time_payment_pct, last_payment_date, last_payment_amount")
          .in("customer_id", custIds);
        if (behaviorSummaryErr) console.error("v_payment_behaviour query error:", behaviorSummaryErr.message);
        results.payment_behavior_summary = behaviorSummary ?? null;

        if (custIdSource === "sector" && behaviorSummary && behaviorSummary.length > 0) {
          // Sector-wide (not a named company): also pre-compute the sector-wide
          // totals/weighted averages from the per-customer rows just fetched —
          // otherwise the model would still have to average up to 50 pre-computed
          // rows itself. Rates are weighted by each customer's total_payments count
          // rather than averaged naively, since transaction volumes vary widely.
          const totalPayments = behaviorSummary.reduce((sum: number, c: any) => sum + (c.total_payments ?? 0), 0);
          const weightedSum = (field: string) =>
            behaviorSummary.reduce((sum: number, c: any) => sum + (c[field] ?? 0) * (c.total_payments ?? 0), 0);
          results.payment_behavior_sector_summary = {
            sector: sector!,
            count: behaviorSummary.length,
            total_payments: totalPayments,
            total_paid_all_time: behaviorSummary.reduce((sum: number, c: any) => sum + (c.total_paid_all_time ?? 0), 0),
            avg_days_to_pay: totalPayments > 0 ? Math.round((weightedSum("avg_days_to_pay") / totalPayments) * 10) / 10 : null,
            avg_days_early_late: totalPayments > 0 ? Math.round((weightedSum("avg_days_early_late") / totalPayments) * 10) / 10 : null,
            on_time_payment_pct: totalPayments > 0 ? Math.round((weightedSum("on_time_payment_pct") / totalPayments) * 10) / 10 : null,
          };
        }
      } else {
        // Portfolio-wide question (no named customer or sector): also fetch
        // pre-computed, deterministic aggregate totals — averaging/summing the
        // raw transactions or per-customer rows is unreliable at this scale.
        const { data: portfolioBehaviorSummary, error: portfolioBehaviorSummaryErr } = await supabase
          .from("v_payment_behaviour_portfolio")
          .select("*")
          .single();
        if (portfolioBehaviorSummaryErr) console.error("v_payment_behaviour_portfolio query error:", portfolioBehaviorSummaryErr.message);
        results.payment_behavior_portfolio_summary = portfolioBehaviorSummary ?? null;
      }

      const { data } = await q;

      const resultCustIds = [...new Set((data ?? []).map((p: any) => p.customer_id))];
      let customerMap: Record<string, string> = {};
      if (resultCustIds.length > 0) {
        const { data: custData, error: custDataErr } = await supabase
          .from("customers")
          .select("id, company_name")
          .in("id", resultCustIds);
        if (custDataErr) console.error("customers lookup error:", custDataErr.message);
        customerMap = Object.fromEntries((custData ?? []).map((c: any) => [c.id, c.company_name]));
      }

      results.payment_transactions = (data ?? []).map((p: any) => ({
        ...p,
        company_name: customerMap[p.customer_id] ?? p.customer_id,
      }));
    })(),

    // negative_news — keyword search
    tables.has("negative_news") && (async () => {
      const baseQuery = () => supabase
        .from("negative_news")
        .select("id, customer_id, headline, summary, source, news_date, severity, sentiment_score, category, customers!left(company_name)")
        .eq("is_demo", demoMode)
        .order("news_date", { ascending: false })
        .limit(10);

      if (keywords.length > 0) {
        const orFilter = keywords.map(kw => `headline.ilike.%${kw}%`).join(",");
        const { data: filtered, error: filteredErr } = await baseQuery().or(orFilter);
        if (filteredErr) console.error("negative_news filter error:", filteredErr.message);
        if (filtered && filtered.length > 0) {
          results.negative_news = filtered;
          results.negative_news_matched = filtered;
          return;
        }
      }
      const { data } = await baseQuery();
      results.negative_news = data ?? [];
    })(),

    // sec_filings — most recent with risk signals
    tables.has("sec_filings") && (async () => {
      const { data } = await supabase
        .from("sec_filings")
        .select("id, customer_id, filing_type, filing_date, risk_signals, key_findings, accession_number, customers!left(company_name)")
        .eq("is_demo", demoMode)
        .order("filing_date", { ascending: false })
        .limit(10);
      results.sec_filings = data ?? [];
      // Filings are sources only when the question named a customer that has filings
      // (the fetch itself is unfiltered top-10, so we intersect with named customers
      // here to avoid over-sourcing portfolio/unknown-customer questions).
      if (companyMentions.length > 0) {
        results.sec_filings_matched = (data ?? []).filter((f: any) => {
          const cn = (f.customers?.company_name ?? "").toLowerCase();
          return cn && companyMentions.some(w => cn.includes(w.toLowerCase()));
        });
      }
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

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    // Extract table routing, company mentions, and sector via a dedicated LLM call
    // (falls back to the old regex logic on any failure) — replaces the regex-only
    // routeQuestion call as the primary path.
    const { tables, company_mentions: companyMentions, sector } = await extractQuestionEntities(anthropic, question);

    // Fetch data from all relevant tables in parallel
    const data = await fetchRelevantData(supabaseClient, question, tables, DEMO_MODE, companyMentions, sector);

    // Build context string — sanitize all text fields to prevent JSON parse errors
    // in Claude's response (quotes, backslashes, newlines in DB fields break output JSON)
    const contextParts: string[] = [];

    // Populated alongside contextParts: tag -> record, so citations the model makes
    // inline (e.g. [E3]) can be mechanically verified against real provided rows.
    const tagMap = new Map<string, TagLookupEntry>();

    // Hoisted out of the customers block below (which is otherwise its own scope)
    // so it's still reachable after Call 1, when the {{HIGH_UTILIZATION_LIST}}
    // marker (if present) gets spliced with this exact, already-correct data.
    let highUtilizationLines: { tag: string; company_name: string | null; credit_limit: number | null; current_exposure: number | null }[] = [];

    if (data.customers.length > 0) {
      // Single pass: assign each customer's tag once, keep the customer object and
      // rendered line together so the high-risk summary below can reuse the exact
      // same tag rather than minting a second one for the same row.
      const customerLines = data.customers.map((c: any, i: number) => {
        const tag = `C${i + 1}`;
        tagMap.set(tag, {
          table: "customers",
          id: c.id ?? null,
          customer_id: c.id ?? null,
          customer_name: c.company_name ?? null,
          event_type: null,
          severity: null,
          date: null,
          agent: null,
        });
        return {
          tag,
          customer: c,
          line: `- [${tag}] ${sanitize(c.company_name)} (type:${sanitize(c.company_type)}, credit_limit=$${c.credit_limit?.toLocaleString()}, balance=$${c.current_exposure?.toLocaleString()}, utilization=${c.credit_limit ? Math.round(c.current_exposure / c.credit_limit * 100) : "N/A"}%, ${c.credit_rating_score != null ? `credit_score=${c.credit_rating_score}/100 (${sanitize(c.credit_rating_raw) || "N/A"} from ${sanitize(c.credit_rating_source) || "N/A"})` : "credit_score=NR (No Rating, provider=N/A)"}, scenario=${sanitize(c.scenario) || "N/A"}, payment_health=${sanitize(c.payment_health) || "unknown"}, risk_tags=[${(c.risk_tags ?? []).map(sanitize).join(", ")}]${c.is_high_risk ? ', RISK_FLAG=HIGH' : ''})`,
        };
      });

      // Structural reinforcement of the RISK_FLAG=HIGH prompt instruction: an unmissable,
      // dedicated section pushed first, listing the locked V1 high-risk set by itself so
      // it can't get lost in a long customer table or out-competed by credit_events content.
      const highRiskLines = customerLines.filter(({ customer }) => customer.is_high_risk);
      if (highRiskLines.length > 0) {
        const highRiskTotalCreditLimit = highRiskLines.reduce((sum, { customer: c }) => sum + (c.credit_limit ?? 0), 0);
        const highRiskTotalExposure = highRiskLines.reduce((sum, { customer: c }) => sum + (c.current_exposure ?? 0), 0);
        contextParts.push(
          `## OFFICIAL HIGH-RISK CUSTOMER LIST (business-locked ranking — the complete, authoritative answer to any "highest risk" / "most at-risk" portfolio-wide question)\n` +
          highRiskLines.map(({ tag, customer: c }) =>
            `- ${sanitize(c.company_name)} [${tag}] (credit_score=${c.credit_rating_score ?? "NR"}/100, scenario=${sanitize(c.scenario) || "N/A"})`
          ).join("\n") +
          `\n- Combined credit limit across this high-risk set: $${highRiskTotalCreditLimit.toLocaleString()}\n` +
          `- Combined current exposure across this high-risk set: $${highRiskTotalExposure.toLocaleString()}`
        );
      }

      // Structural reinforcement matching the RISK_FLAG=HIGH pattern above, for a
      // different criterion (utilization threshold, not the locked V1 risk rule).
      // 85% chosen: sits in a natural gap in the portfolio's utilization distribution
      // (a dense 88-97% cluster vs. a normal 55-80% band), and matches this project's
      // own DEMO_BRIEFING copy, which already calls 87% "approaching".
      //
      // data.customers is complete for every branch (named, sector, and portfolio-wide
      // since fn_rank_portfolio_risk's LIMIT 25 was removed in migration 20260902000000),
      // so customerLines can be filtered directly — no separate complete-data-source
      // fallback needed anymore.
      highUtilizationLines = customerLines
        .map(({ tag, customer: c }) => ({ tag, company_name: c.company_name, credit_limit: c.credit_limit, current_exposure: c.current_exposure }))
        .filter((c) => (c.credit_limit ?? 0) > 0 && ((c.current_exposure ?? 0) / (c.credit_limit as number)) >= 0.85);
      if (highUtilizationLines.length > 0) {
        contextParts.push(
          `## OFFICIAL HIGH-UTILIZATION CUSTOMER LIST (computed from credit_limit/current_exposure across the complete customer set, threshold utilization >= 85% — the complete, authoritative answer to any "approaching their credit limit" / "near their limit" / "over their credit limit" question)\n` +
          highUtilizationLines.map((c) =>
            `- ${sanitize(c.company_name)} [${c.tag}] (utilization=${Math.round(((c.current_exposure as number) / (c.credit_limit as number)) * 100)}%, balance=$${c.current_exposure?.toLocaleString()}, credit_limit=$${c.credit_limit?.toLocaleString()})`
          ).join("\n")
        );
      }

      if (data.customers_combined_total) {
        const t = data.customers_combined_total;
        contextParts.push(
          `## OFFICIAL COMBINED TOTAL — NAMED CUSTOMERS (pre-computed, deterministic — the authoritative combined figure across the ${t.count} companies named in this question; do not recompute by summing the CUSTOMERS TABLE rows yourself)\n` +
          `- Companies included: ${t.company_names.join(", ")}\n` +
          `- Combined credit limit: $${Number(t.total_credit_limit).toLocaleString()}\n` +
          `- Combined current exposure: $${Number(t.total_current_exposure).toLocaleString()}`
        );
      }

      if (data.customers_sector_total) {
        const s = data.customers_sector_total;
        contextParts.push(
          `## OFFICIAL SECTOR EXPOSURE TOTAL (pre-computed, deterministic — the authoritative combined figure across all ${s.count} customers in the ${sanitize(s.sector)} sector; do not recompute by summing the CUSTOMERS TABLE rows yourself)\n` +
          `- Sector: ${sanitize(s.sector)}\n` +
          `- Customer count: ${s.count}\n` +
          `- Combined credit limit: $${Number(s.total_credit_limit).toLocaleString()}\n` +
          `- Combined current exposure: $${Number(s.total_current_exposure).toLocaleString()}`
        );
      }

      contextParts.push("## CUSTOMERS TABLE\n" + customerLines.map(({ line }) => line).join("\n"));
    }

    if (data.ar_aging_portfolio_summary) {
      const s = data.ar_aging_portfolio_summary;
      contextParts.push(
        `## OFFICIAL AR AGING PORTFOLIO TOTALS (pre-computed, deterministic — the complete and authoritative answer to any portfolio-wide "total overdue" / "total exposure" / "aging summary" question; do not recompute these by summing individual invoices)\n` +
        `- Current: $${Number(s.total_current ?? 0).toLocaleString()} (${s.pct_current ?? 0}%, ${s.total_current_count ?? "N/A"} invoices)\n` +
        `- 1-30 days overdue: $${Number(s.total_1_30 ?? 0).toLocaleString()} (${s.pct_1_30 ?? 0}%, ${s.total_bucket_1_30_count ?? "N/A"} invoices)\n` +
        `- 31-60 days overdue: $${Number(s.total_31_60 ?? 0).toLocaleString()} (${s.pct_31_60 ?? 0}%, ${s.total_bucket_31_60_count ?? "N/A"} invoices)\n` +
        `- 61-90 days overdue: $${Number(s.total_61_90 ?? 0).toLocaleString()} (${s.pct_61_90 ?? 0}%, ${s.total_bucket_61_90_count ?? "N/A"} invoices)\n` +
        `- 90+ days overdue: $${Number(s.total_over_90 ?? 0).toLocaleString()} (${s.pct_over_90 ?? 0}%, ${s.total_bucket_over_90_count ?? "N/A"} invoices)\n` +
        `- Pre-petition (bankruptcy, frozen): $${Number(s.total_pre_petition ?? 0).toLocaleString()}\n` +
        `- Total outstanding: $${Number(s.total_outstanding ?? 0).toLocaleString()}\n` +
        `- Customers with outstanding AR: ${s.customer_count ?? "N/A"}\n` +
        `- As of: ${s.snapshot_date ?? "N/A"}`
      );
    }

    if (data.ar_aging_customer_summary && data.ar_aging_customer_summary.length > 0) {
      contextParts.push(
        `## OFFICIAL AR AGING TOTALS — NAMED CUSTOMER(S) (pre-computed, deterministic — the authoritative answer to a named customer's total overdue balance or aging-bucket breakdown; do not recompute these by summing individual invoices)\n` +
        data.ar_aging_customer_summary.map((s: any) =>
          `- ${sanitize(s.company_name)}: current=$${Number(s.current_amount ?? 0).toLocaleString()} (${s.current_count ?? "N/A"} invoices), 1-30=$${Number(s.bucket_1_30 ?? 0).toLocaleString()} (${s.bucket_1_30_count ?? "N/A"} invoices), 31-60=$${Number(s.bucket_31_60 ?? 0).toLocaleString()} (${s.bucket_31_60_count ?? "N/A"} invoices), 61-90=$${Number(s.bucket_61_90 ?? 0).toLocaleString()} (${s.bucket_61_90_count ?? "N/A"} invoices), 90+=$${Number(s.bucket_over_90 ?? 0).toLocaleString()} (${s.bucket_over_90_count ?? "N/A"} invoices), pre_petition=$${Number(s.pre_petition_amount ?? 0).toLocaleString()}, total_outstanding=$${Number(s.total_outstanding ?? 0).toLocaleString()}, utilization=${s.utilization_pct ?? "N/A"}%, risk_tier=${s.risk_tier ?? "N/A"}, invoice_count=${s.total_invoice_count ?? "N/A"}`
        ).join("\n")
      );
    }

    if (data.ar_aging_sector_summary) {
      const s = data.ar_aging_sector_summary;
      contextParts.push(
        `## OFFICIAL AR AGING SECTOR TOTAL (pre-computed, deterministic — the authoritative summed total across all ${s.count} customers in the ${sanitize(s.sector)} sector; do not recompute by summing the per-customer rows above or the raw INVOICES TABLE yourself)\n` +
        `- Sector: ${sanitize(s.sector)}\n` +
        `- Customer count: ${s.count}\n` +
        `- Current: $${Number(s.total_current).toLocaleString()} (${s.current_count ?? "N/A"} invoices)\n` +
        `- 1-30 days overdue: $${Number(s.total_1_30).toLocaleString()} (${s.bucket_1_30_count ?? "N/A"} invoices)\n` +
        `- 31-60 days overdue: $${Number(s.total_31_60).toLocaleString()} (${s.bucket_31_60_count ?? "N/A"} invoices)\n` +
        `- 61-90 days overdue: $${Number(s.total_61_90).toLocaleString()} (${s.bucket_61_90_count ?? "N/A"} invoices)\n` +
        `- 90+ days overdue: $${Number(s.total_over_90).toLocaleString()} (${s.bucket_over_90_count ?? "N/A"} invoices)\n` +
        `- Pre-petition (bankruptcy, frozen): $${Number(s.total_pre_petition).toLocaleString()}\n` +
        `- Total outstanding: $${Number(s.total_outstanding).toLocaleString()}`
      );
    }

    if (data.invoices.length > 0) {
      contextParts.push("## INVOICES TABLE\n" + data.invoices.map((inv: any, i: number) => {
        const tag = `I${i + 1}`;
        tagMap.set(tag, {
          table: "invoices",
          id: inv.id ?? null,
          customer_id: inv.customer_id ?? null,
          customer_name: inv.company_name ?? null,
          event_type: null,
          severity: null,
          date: inv.due_date ?? null,
          agent: null,
        });
        return `- [${tag}] ${sanitize(inv.company_name)}: invoice ${sanitize(inv.invoice_number)}, amount=$${inv.invoice_amount?.toLocaleString()}, outstanding=$${inv.outstanding_amount?.toLocaleString()}, due=${inv.due_date}, status=${inv.status}, days_overdue=${inv.days_overdue}`;
      }).join("\n"));
    }

    if (data.payment_behavior_summary && data.payment_behavior_summary.length > 0) {
      contextParts.push(
        `## OFFICIAL PAYMENT BEHAVIOR TOTALS (pre-computed, deterministic — the authoritative answer to a named customer's average days to pay, on-time rate, or total paid; do not recompute these by averaging or summing the raw PAYMENT TRANSACTIONS TABLE yourself)\n` +
        data.payment_behavior_summary.map((p: any) =>
          `- ${sanitize(p.company_name)}: total_payments=${p.total_payments ?? "N/A"}, total_paid_all_time=$${Number(p.total_paid_all_time ?? 0).toLocaleString()}, avg_days_to_pay=${p.avg_days_to_pay ?? "N/A"}, avg_days_early_late=${p.avg_days_early_late ?? "N/A"} (${(p.avg_days_early_late ?? 0) > 0 ? "late" : (p.avg_days_early_late ?? 0) < 0 ? "early" : "on time"}), on_time_rate=${p.on_time_payment_pct ?? "N/A"}%, last_payment=$${Number(p.last_payment_amount ?? 0).toLocaleString()} on ${p.last_payment_date ?? "N/A"}`
        ).join("\n")
      );
    }

    if (data.payment_behavior_sector_summary) {
      const s = data.payment_behavior_sector_summary;
      contextParts.push(
        `## OFFICIAL PAYMENT BEHAVIOR SECTOR TOTAL (pre-computed, deterministic — the authoritative combined figure across all ${s.count} customers in the ${sanitize(s.sector)} sector, with rates weighted by each customer's payment volume; do not recompute by averaging or summing the per-customer rows above or the raw PAYMENT TRANSACTIONS TABLE yourself)\n` +
        `- Sector: ${sanitize(s.sector)}\n` +
        `- Customer count: ${s.count}\n` +
        `- Total payments: ${s.total_payments}\n` +
        `- Total paid (all time): $${Number(s.total_paid_all_time).toLocaleString()}\n` +
        `- Weighted avg days to pay: ${s.avg_days_to_pay ?? "N/A"}\n` +
        `- Weighted avg days early/late: ${s.avg_days_early_late ?? "N/A"} (${(s.avg_days_early_late ?? 0) > 0 ? "late" : (s.avg_days_early_late ?? 0) < 0 ? "early" : "on time"})\n` +
        `- Weighted on-time rate: ${s.on_time_payment_pct ?? "N/A"}%`
      );
    }

    if (data.payment_behavior_portfolio_summary) {
      const s = data.payment_behavior_portfolio_summary;
      contextParts.push(
        `## OFFICIAL PAYMENT BEHAVIOR PORTFOLIO TOTALS (pre-computed, deterministic — the complete and authoritative answer to any portfolio-wide "average days to pay" / "on-time rate" / "total paid" question; do not recompute these by averaging or summing the raw PAYMENT TRANSACTIONS TABLE or per-customer rows yourself)\n` +
        `- Customers with payment history: ${s.customer_count ?? "N/A"}\n` +
        `- Total payments: ${s.total_payments ?? "N/A"}\n` +
        `- Total paid (all time): $${Number(s.total_paid_all_time ?? 0).toLocaleString()}\n` +
        `- Total paid (last 12mo): $${Number(s.total_paid_12mo ?? 0).toLocaleString()}\n` +
        `- Avg days to pay: ${s.avg_days_to_pay ?? "N/A"}\n` +
        `- Avg days early/late: ${s.avg_days_early_late ?? "N/A"} (${(s.avg_days_early_late ?? 0) > 0 ? "late" : (s.avg_days_early_late ?? 0) < 0 ? "early" : "on time"})\n` +
        `- On-time rate: ${s.on_time_payment_pct ?? "N/A"}%\n` +
        `- Last payment: ${s.last_payment_date ?? "N/A"}`
      );
    }

    if (data.payment_transactions.length > 0) {
      contextParts.push("## PAYMENT TRANSACTIONS TABLE\n" + data.payment_transactions.map((p: any, i: number) => {
        const tag = `P${i + 1}`;
        tagMap.set(tag, {
          table: "payment_transactions",
          id: null,
          customer_id: p.customer_id ?? null,
          customer_name: p.company_name ?? null,
          event_type: null,
          severity: null,
          date: p.payment_date ?? null,
          agent: null,
        });
        return `- [${tag}] ${sanitize(p.company_name)}: paid $${p.amount_paid?.toLocaleString()} on ${p.payment_date}, days_to_pay=${p.days_to_pay}, days_early_late=${p.days_early_late} (${p.days_early_late > 0 ? "late" : p.days_early_late < 0 ? "early" : "on time"}), method=${p.payment_method}`;
      }).join("\n"));
    }

    if (data.negative_news.length > 0) {
      contextParts.push("## NEGATIVE NEWS TABLE\n" + data.negative_news.map((n: any, i: number) => {
        const tag = `N${i + 1}`;
        tagMap.set(tag, {
          table: "negative_news",
          id: n.id ?? null,
          customer_id: n.customer_id ?? null,
          customer_name: n.customers?.company_name ?? null,
          event_type: "NEGATIVE_NEWS",
          severity: n.severity ?? null,
          date: n.news_date ? String(n.news_date).slice(0, 10) : null,
          agent: "news_monitor_agent",
        });
        return `- [${tag}] ${sanitize(n.customers?.company_name) || "Unknown"}: ${sanitize(n.headline)} (${sanitize(n.source)}, ${n.news_date}), severity=${n.severity}, sentiment=${n.sentiment_score}`;
      }).join("\n"));
    }

    if (data.sec_filings.length > 0) {
      contextParts.push("## SEC FILINGS TABLE\n" + data.sec_filings.map((f: any, i: number) => {
        const tag = `F${i + 1}`;
        tagMap.set(tag, {
          table: "sec_filings",
          id: f.customer_id ?? null,
          customer_id: f.customer_id ?? null,
          customer_name: f.customers?.company_name ?? null,
          event_type: f.filing_type ?? "SEC_FILING",
          severity: null,
          date: f.filing_date ? String(f.filing_date).slice(0, 10) : null,
          agent: "sec_monitor_agent",
        });
        return `- [${tag}] ${sanitize(f.customers?.company_name) || "Unknown"}: ${f.filing_type} filed ${f.filing_date}, risk_signals=[${(f.risk_signals ?? []).map(sanitize).join(", ")}]`;
      }).join("\n"));
    }

    if (data.multi_signal_convergence && data.multi_signal_convergence.length > 0) {
      contextParts.push(
        `## OFFICIAL MULTI-SIGNAL CONVERGENCE LIST (pre-computed, deterministic — the complete and authoritative answer to any "which customers are flagged by multiple agents" / "multi-signal convergence" question; computed via GROUP BY + HAVING over the full 90-day credit_events window, not inferred from the CREDIT EVENTS TABLE below, which is not guaranteed to include every qualifying event for this purpose)\n` +
        data.multi_signal_convergence.map((row: any, i: number) => {
          const tag = `M${i + 1}`;
          tagMap.set(tag, {
            table: "customers",
            id: row.customer_id ?? null,
            customer_id: row.customer_id ?? null,
            customer_name: row.company_name ?? null,
            event_type: null,
            severity: null,
            date: row.latest_event_date ? String(row.latest_event_date).slice(0, 10) : null,
            agent: null,
          });
          return `- [${tag}] ${sanitize(row.company_name)}: flagged by ${row.distinct_agent_count} agents (${(row.agents ?? []).map(sanitize).join(", ")}), ${row.event_count} events, max_severity_score=${row.max_severity_score ?? "N/A"}, latest_event=${row.latest_event_date ? String(row.latest_event_date).slice(0, 10) : "N/A"}`;
        }).join("\n")
      );
    }

    if (data.credit_events.length > 0) {
      contextParts.push("## CREDIT EVENTS TABLE\n" + data.credit_events.map((e: any, i: number) => {
        const tag = `E${i + 1}`;
        tagMap.set(tag, {
          table: "credit_events",
          id: e.id ?? null,
          customer_id: e.customer_id ?? null,
          customer_name: e.customers?.company_name ?? null,
          event_type: e.event_type ?? null,
          severity: e.severity ?? null,
          date: e.created_at ? String(e.created_at).slice(0, 10) : null,
          agent: e.source_agent ?? null,
        });
        return `- [${tag}] ${sanitize(e.customers?.company_name) || "Portfolio"}: ${e.event_type} (${e.severity}) from ${e.source_agent} on ${e.created_at?.split("T")[0]} — ${sanitize(e.title)}${e.description ? ": " + sanitize(e.description) : ""}`;
      }).join("\n"));
    }

    const context = contextParts.join("\n\n");

    const model = DEMO_MODE ? "claude-haiku-4-5" : "claude-sonnet-4-20250514";
    const maxTokens = DEMO_MODE ? 600 : 900;

    try {
      // ── Call 1: plain-text answer — never embedded in JSON ──────────────────
      const answerMessage = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: `You are the Credit Intelligence Agent (CIA) for CreditPilot — a credit analyst answering questions about a B2B trade credit portfolio. Answer ONLY from the data provided. Every record in the data below has a bracketed reference tag (e.g. [E3], [C7], [N1]). After each specific factual claim, cite the exact tag(s) supporting it in brackets immediately after the claim, e.g. "utilization is 91.7% [E3]" or "flagged by two agents [E3, N1]". Cite every tag that supports each claim, using multiple tags when multiple records support one claim. Always cite tags individually, comma-separated — never use a dash or range between two tags (e.g. write [P1, P2, P3], never [P1–P3]). Only ever cite tags that actually appear in the data provided — never invent a tag. These tags are for internal verification and will be removed before the user sees your answer, so cite generously and precisely without worrying about how it reads. Be specific with exact amounts, dates, and percentages. When asked broadly which customers are highest-risk or most at-risk across the whole portfolio (not about one named customer), the customers table's RISK_FLAG=HIGH marker is the authoritative, business-approved answer — always name every RISK_FLAG=HIGH customer in your response. You may add supporting detail from credit_events, but never substitute a different framing (e.g. ranking by most recent event, or by utilization percentage alone) for the complete RISK_FLAG=HIGH list. If asked for the combined exposure or credit limit of that high-risk set, use the combined figures stated in that section directly, not a manual sum. When asked broadly whether any customers are approaching or over their credit limit (not about one named customer), do not name individual customers, percentages, or a count yourself from the OFFICIAL HIGH-UTILIZATION CUSTOMER LIST section — reproducing that list from memory is unreliable. Instead, write one brief intro sentence acknowledging the question, then insert the exact literal text {{HIGH_UTILIZATION_LIST}} alone, on its own line — the real list will be inserted automatically afterward. If the question does not call for the complete list (e.g. it's about one named customer, or unrelated to utilization or credit-limit proximity), do not include the placeholder at all. For portfolio-wide AR aging or total-exposure questions (not about one named customer), use the pre-computed totals in the OFFICIAL AR AGING PORTFOLIO TOTALS section directly — never re-derive these totals by summing individual invoice line items yourself, since manual summation across many records is unreliable. For a named customer's AR aging totals, use the OFFICIAL AR AGING TOTALS — NAMED CUSTOMER(S) section the same way. For a sector-wide AR aging or total-overdue question (e.g. "total overdue for the aerospace sector"), use the OFFICIAL AR AGING SECTOR TOTAL section directly — never sum the per-customer rows above it or the raw INVOICES TABLE yourself. Use the raw INVOICES TABLE only to name or describe specific individual invoices when asked, not to recompute aggregate totals. When a question names two or more specific companies and asks for a combined or total figure across them, use the OFFICIAL COMBINED TOTAL — NAMED CUSTOMERS section directly, never sum the CUSTOMERS TABLE rows yourself. For a sector-wide total exposure or credit limit question (e.g. "total exposure to the aerospace sector"), use the OFFICIAL SECTOR EXPOSURE TOTAL section directly, never sum the CUSTOMERS TABLE rows yourself. For a named customer's payment history (average days to pay, on-time rate, total paid), use the pre-computed figures in the OFFICIAL PAYMENT BEHAVIOR TOTALS section directly — never re-derive them by averaging or summing the raw PAYMENT TRANSACTIONS TABLE yourself; use that raw table only to list or describe specific individual transactions when asked. For a sector-wide payment behavior question (e.g. "average days to pay for the aerospace sector"), use the OFFICIAL PAYMENT BEHAVIOR SECTOR TOTAL section directly, never average or sum the per-customer rows above it yourself. For a portfolio-wide payment behavior question (e.g. "average days to pay across the whole portfolio", not about one named customer or sector), use the OFFICIAL PAYMENT BEHAVIOR PORTFOLIO TOTALS section directly, never average or sum the raw PAYMENT TRANSACTIONS TABLE or per-customer rows yourself. For questions asking which customers are flagged by multiple agents, or about multi-signal convergence, use the OFFICIAL MULTI-SIGNAL CONVERGENCE LIST section directly — it's the complete, authoritative answer computed over the full 90-day window; never infer convergence by counting agents per customer from the raw CREDIT EVENTS TABLE yourself, since that table is not guaranteed to include every qualifying event. If data does not contain the answer say exactly: I don't have that information in the current data. Do NOT characterize a customer's relationship status (active, inactive, outside the portfolio, former, prospect, etc.) unless the data explicitly states it. Every company in the customers table is a current customer. If you don't know a customer's relationship status, don't mention it — just present the facts. Never use the words 'supplier', 'suppliers', 'vendor', 'vendors', or any 'tier-N' phrasing (tier-1, tier-2, etc.) anywhere in your response. This applies to ALL uses — including generic plurals like 'multiple suppliers' or 'aerospace suppliers', industry-structure descriptions like 'Tier-1 supplier', and any other context. Refer to companies in the customers table only as 'customers', 'companies', or 'accounts'. The word 'supplier' must never appear in your output. Keep response under 120 words. Exception: if the question asks to list, enumerate, or itemize individual records (e.g. every invoice, every transaction) rather than a summary, pull from the specific raw data table (not aggregate event summaries) and list up to 15 individual items with their specific values — this may exceed 120 words. If more than 15 matching records exist, list the first 15 and state the total count. This exception also applies to questions asking which customers or companies meet a broad criterion across the whole portfolio (e.g. "highest risk", "over their credit limit", "in the aerospace sector") — name every matching customer completely, even if that exceeds 120 words; do not truncate or cap this type of complete-set answer. Use markdown with **bold key terms**. Plain text output only — no JSON.`,
        messages: [{
          role: "user",
          content: `Question: ${question}\n\nData:\n${context || "No relevant data found."}`,
        }],
      });
      const rawAnswerText = extractText(answerMessage);

      // ── Deterministic list splice: if the model decided this question calls for
      // the complete high-utilization list, it emits the marker instead of naming
      // customers/percentages/a count itself (both unreliable at this scale). Replace
      // it here, before tag verification/stripping runs, with a block built directly
      // from highUtilizationLines — including real [tag] citations from tagMap, so
      // the existing (unmodified) verification/stripping/sources pipeline below picks
      // them up exactly like any other citation, with nothing to special-case.
      const answerText = HIGH_UTIL_MARKER_TEST.test(rawAnswerText)
        ? rawAnswerText.replace(HIGH_UTIL_MARKER_REPLACE, buildHighUtilizationListBlock(highUtilizationLines))
        : rawAnswerText;

      // ── Mechanical citation verification: extract [tags] the model cited, keep
      // only those matching a real record in tagMap, then strip all bracket tags
      // (valid or not) from the text shown to the user. ──────────────────────────
      const citedTags = new Set<string>();
      const bracketPattern = /\[([^\]]+)\]/g;
      let bracketMatch: RegExpExecArray | null;
      while ((bracketMatch = bracketPattern.exec(answerText)) !== null) {
        for (const piece of bracketMatch[1].split(",")) {
          const tag = piece.trim();
          if (/^[CIPNFEUM]\d+$/.test(tag)) citedTags.add(tag);
        }
      }
      const verifiedTags = [...citedTags].filter(t => tagMap.has(t));

      // Stripping is intentionally more permissive than verification: a lone tag or a
      // tag-range (e.g. "P1-P8", "P1–8") is still tag-shaped and should never leak into
      // the visible answer as a raw artifact, even though a range is never treated as a
      // verified citation (citedTags/verifiedTags above stay strict, unchanged).
      const tagOrRangePattern = /^[CIPNFEUM]\d+(\s*[-–—]\s*[CIPNFEUM]?\d+)?$/;

      const cleanAnswerText = answerText
        .replace(/\[([^\]]+)\]/g, (full, inner) =>
          inner.split(",").every((p: string) => tagOrRangePattern.test(p.trim())) ? "" : full
        )
        .replace(/\s+([.,;:!?])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

      // ── Call 2: structured metadata only — small JSON, no embedded answer ───
      let meta: { confidence: string; confidence_reason: string } = {
        confidence: "Medium",
        confidence_reason: "See answer for details",
      };
      let metaMessage: Anthropic.Message | undefined;
      try {
        metaMessage = await anthropic.messages.create({
          model: DEMO_MODE ? "claude-haiku-4-5" : "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: `Return ONLY valid JSON, no other text. You are grading an answer about a B2B trade credit portfolio.

The grade reflects whether the answer's claims are supported by the data provided, nothing else.

- High: every specific claim in the answer (companies, scores, percentages, scenarios, risk tags, event types, dates) maps to a row in one of the provided tables. Drawing facts from multiple tables (customers + credit_events) is normal and does NOT reduce the grade. Absence of credit_events for some companies does NOT reduce the grade — no negative events on file is a positive state, not missing data.
- Medium: the answer makes at least one specific claim (an event type, an alert, a severity, a date, a name) that does not appear in any provided table.
- Low: the answer relies primarily on inference, external knowledge, or speculation rather than the data.

RELATIONSHIP-QUALIFIER CHECK: If the answer characterizes a customer's relationship status using words like 'outside', 'not in', 'outside the portfolio', 'outside our portfolio', 'former customer', 'prospect', 'inactive', or implies they are not a current customer — verify against the data. Every company appearing in the customers table IS a current customer. If the answer uses one of these qualifiers about a company that appears in the customers data provided, set confidence to Medium and explain this specifically in confidence_reason. This rule takes priority over the other rubric tiers.

Do not penalize for: using multiple tables, citing credit_events when available, mentioning companies that have ratings but no credit_events, or any form of cross-table synthesis. These are all good behaviors.

Schema: {"confidence":"High|Medium|Low","confidence_reason":"one sentence stating which rubric tier applies and why"}`,
          messages: [{
            role: "user",
            content: `Based on this answer and data, provide confidence and sources.\n\nAnswer: ${cleanAnswerText}\n\nData:\n${context}`,
          }],
        });
        const metaText = extractText(metaMessage);
        let metaCleaned = metaText.replace(/```json/gi, "").replace(/```/g, "").trim();
        // Isolate the JSON object in case the model added preamble/trailing text
        const firstBrace = metaCleaned.indexOf("{");
        const lastBrace = metaCleaned.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          metaCleaned = metaCleaned.slice(firstBrace, lastBrace + 1);
        }
        meta = JSON.parse(metaCleaned);
      } catch (err) {
        console.error("[cia-agent] meta JSON parse failed, using defaults. Raw output:", metaMessage ? extractText(metaMessage)?.slice(0, 500) : "(no response)", "Error:", (err as Error).message);
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
            content: `Answer just given: ${cleanAnswerText.slice(0, 500)}\n\nGenerate 3 follow-up questions.`,
          }],
        });
        const followUpText = extractText(followUpMessage);
        const followUpCleaned = followUpText.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(followUpCleaned);
        if (Array.isArray(parsed)) relatedQuestions = parsed;
      } catch {
        // keep fallback suggestions
      }

      // Build sources deterministically from mechanically-verified inline citation
      // tags — a tag only survives if the model actually cited it AND it corresponds
      // to a real record provided in the context (never from LLM self-report alone).
      // credit_events/negative_news route to that specific event's own record (their
      // pages highlight by event id); customers/invoices/payment_transactions/sec_filings
      // have no dedicated per-row destination, so they route to the owning customer's
      // detail page via customer_id instead.
      const sources: Array<{event_id: string; source_type: "credit_events" | "negative_news" | "sec_filings" | "customers" | "invoices" | "payment_transactions"; customer_name: string; event_type: string | null; severity: string | null; date: string | null; agent: string | null}> = [];
      for (const tag of verifiedTags) {
        const entry = tagMap.get(tag)!;
        const eventId = (entry.table === "credit_events" || entry.table === "negative_news") ? entry.id : entry.customer_id;
        if (!eventId || !entry.customer_name) continue;
        sources.push({
          event_id: eventId,
          source_type: entry.table,
          customer_name: entry.customer_name,
          event_type: entry.event_type,
          severity: entry.severity,
          date: entry.date,
          agent: entry.agent,
        });
      }

      return jsonRes({
        answer: cleanAnswerText,
        sources,
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
  const { data: recentRuns, error: recentRunsError } = await supabaseClient
    .from("agent_runs")
    .select("id, agent_name, status, completed_at")
    .in("agent_name", ["ar-aging-agent", "news-monitor-agent", "sec-monitor-agent"])
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (recentRunsError) console.error("[cia-agent] agent_runs query failed:", recentRunsError.message);

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
  const { data: customers, error: customersError } = await supabaseClient
    .from("customers")
    .select("id, company_name, company_type, credit_limit, current_exposure, credit_rating_score, credit_rating_previous_score, payment_on_time_rate, payment_trend, payment_health")
    .in("id", customerIds);
  if (customersError) console.error("[cia-agent] customers query failed:", customersError.message);

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
        title: `Multi-signal risk: ${customer?.company_name ?? custId}`,
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
    const arEvent = custEvents.find((e: any) => e.payload?.utilization_percent != null) as any;
    const utilizationPct: number = arEvent?.payload?.utilization_percent ?? 0;
    const daysOver90: number = (custEvents.find((e: any) => e.payload?.bucket_over_90_usd != null) as any)?.payload?.bucket_over_90_usd ?? 0;
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
      company_name: customer.company_name ?? custId,
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
