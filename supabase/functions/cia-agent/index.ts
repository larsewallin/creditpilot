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
 *                 force_refresh?: boolean, customer_id?: string, skip_briefing?: boolean }
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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.0";
import { assessCompositeRisk } from "../_shared/skills/analytical/assess-composite-risk.ts";
import { calculateCreditLimitProposal } from "../_shared/skills/analytical/calculate-credit-limit-proposal.ts";
import { detectRatingChange } from "../_shared/skills/analytical/detect-rating-change.ts";
import { composeTeamsAlert } from "../_shared/skills/generative/compose-teams-alert.ts";
import { deliverMessage, EmailProvider, TeamsProvider, SlackProvider, LogProvider } from "../_shared/skills/integration/deliver-message.ts";
import { createOnboardingAction } from "../_shared/onboarding/decision.ts";
import { summarizeScoreSources, scoreSourceBlocks, type ScoreSourceSummary } from "../_shared/skills/analytical/score-source-summary.ts";
import { effectiveSettings } from "../_shared/onboarding/settings_validate.ts";
import { AuthError, requireUser } from "../_shared/auth.ts";
import { agentCallerProblem, sameSecret } from "../_shared/agent_gate.ts";
import { financialsAge } from "../_shared/onboarding/keen_statements.ts";
import { streamClaude, WEB_SEARCH_TOOL, type WebSource } from "../_shared/claude_stream.ts";
import { buildCharts } from "../_shared/cia_charts.ts";
import { ANSWERABLE_TOPICS, capabilityStatus, isAdviceQuestion, playbookBlock } from "../_shared/cia_playbook.ts";

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
  mode?: "briefing" | "question" | "suggestions" | "onboarding";
  /** onboarding mode: the credit application whose proposal becomes a NEW_CREDIT_LIMIT action. */
  application_id?: string;
  question?: string;
  /** mode "shared": the stored answer a share link opens. */
  answer_id?: string;
  /** The conversation so far (CIA thread): the last turns, oldest first. */
  history?: { question?: string; answer?: string }[];
  /** Stream the answer as server-sent events: step, delta, reset, done, error (CIA v2). */
  stream?: boolean;
  /** The question a follow-up click came from (its company carries over). */
  previous_question?: string;
  force_refresh?: boolean;
  customer_id?: string;
  /** Skip the Anthropic briefing call entirely (used by initDemo.ts on reset
   *  -- see 2026-10-02 notes below). DAILY_BRIEFING's text is never surfaced
   *  anywhere in the UI (CreditEvents.tsx explicitly excludes it, pending a
   *  dedicated surface), so a reset-triggered run has no need to spend real
   *  Anthropic tokens generating it; the actual useful output (composite-risk
   *  events + pending_actions) is pure computation, independent of this call. */
  skip_briefing?: boolean;
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
  // Over the limit first (most over first), then close to it: "over their credit limit"
  // and "near their limit" are different answers (seen 2026-11-17: 4 over, 16 close).
  const util = (c: (typeof lines)[number]) => (c.current_exposure as number) / (c.credit_limit as number);
  const bullet = (c: (typeof lines)[number]) =>
    `- **${sanitize(c.company_name)}** — ${Math.round(util(c) * 100)}% utilization (balance $${c.current_exposure?.toLocaleString()}, credit limit $${c.credit_limit?.toLocaleString()}) [${c.tag}]`;
  const over = lines.filter((c) => util(c) > 1).sort((a, b) => util(b) - util(a));
  const near = lines.filter((c) => util(c) <= 1).sort((a, b) => util(b) - util(a));
  const parts: string[] = [];
  parts.push(over.length
    ? `**${over.length} customer${over.length === 1 ? " is" : "s are"} over their credit limit:**\n${over.map(bullet).join("\n")}`
    : "**No customers** are over their credit limit.");
  if (near.length) parts.push(`**${near.length} more ${near.length === 1 ? "is" : "are"} close to it (85–100% of the limit):**\n${near.map(bullet).join("\n")}`);
  return parts.join("\n\n");
}

// Same pattern as HIGH_UTIL_MARKER above, for the locked V1 high-risk set —
// deterministic splice instead of trusting the model to enumerate every
// RISK_FLAG=HIGH customer from memory, which is unreliable once the set
// grows past a handful of names.
const HIGH_RISK_MARKER_TEST = /\{\{\s*HIGH_RISK_LIST\s*\}\}/;
const HIGH_RISK_MARKER_REPLACE = /\{\{\s*HIGH_RISK_LIST\s*\}\}/g;

function buildHighRiskListBlock(
  lines: { tag: string; customer: any; line: string }[]
): string {
  if (lines.length === 0) {
    return "**No customers** currently meet the high-risk criteria.";
  }
  const totalCreditLimit = lines.reduce((sum, { customer: c }) => sum + (c.credit_limit ?? 0), 0);
  const totalExposure = lines.reduce((sum, { customer: c }) => sum + (c.current_exposure ?? 0), 0);
  const bullets = lines.map(({ tag, customer: c }) =>
    `- **${sanitize(c.company_name)}** — credit_score=${c.credit_rating_score ?? "NR"}/100, scenario=${sanitize(c.scenario) || "N/A"}, exposure $${c.current_exposure?.toLocaleString()} [${tag}]`
  ).join("\n");
  return `**${lines.length} customer${lines.length === 1 ? "" : "s"}** currently meet the high-risk criteria (combined credit limit $${totalCreditLimit.toLocaleString()}, combined exposure $${totalExposure.toLocaleString()}):\n${bullets}`;
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
  score_sources: ScoreSourceSummary | null;
  financials_settings: any;
  pending_actions: { company_name: string; action_type: string; current_value: number | null; proposed_value: number | null; severity: string | null }[] | null;
  bankruptcy: { company_name: string; pre_petition: number; invoices: number }[] | null;
  payment_trend: any[] | null;
  payment_trend_named: any[] | null;
  country_totals: { country: string; customers: number; exposure: number; limit: number }[] | null;
  currency_totals: { currency: string; invoices: number; usd: number; local: number }[] | null;
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
    score_sources: null,
    financials_settings: null,
    pending_actions: null,
    bankruptcy: null,
    payment_trend: null,
    payment_trend_named: null,
    country_totals: null,
    currency_totals: null,
  };

  await Promise.allSettled([

    // Score sources and accounts age: counted here, handed to the model as facts.
    (tables.has("customers") || companyMentions.length > 0 || /score|rating|provider|bureau|financial|statement|accounts|year.?end|fye|out.?of.?date|stale|keen|d&b|dun|coface|creditsafe|allianz|experian/i.test(question)) && (async () => {
      const [{ data: rows, error }, { data: settingRows }] = await Promise.all([
        supabase.from("customers").select("company_name, credit_rating_score, credit_rating_source, financials_fye").eq("lifecycle_status", "active").limit(5000),
        supabase.from("company_settings").select("key, value").eq("key", "onboarding.financials"),
      ]);
      if (error) { console.error("score sources error:", error.message); return; }
      const eff = effectiveSettings(Object.fromEntries((settingRows ?? []).map((r: any) => [r.key, r.value]))) as any;
      results.financials_settings = eff.financials;
      results.score_sources = summarizeScoreSources(rows ?? [], eff.financials, new Date().toISOString().slice(0, 10));
    })(),

    // Proposed actions waiting for approval (Actions page): always small, listed in full.
    (async () => {
      const { data, error } = await supabase
        .from("pending_actions")
        .select("action_type, current_value, proposed_value, severity, customers(company_name)")
        .eq("status", "pending").eq("is_demo", demoMode)
        .order("created_at", { ascending: false }).limit(200);
      if (error) { console.error("pending actions error:", error.message); return; }
      results.pending_actions = (data ?? []).map((r: any) => ({
        company_name: r.customers?.company_name ?? "(new customer)", action_type: r.action_type,
        current_value: r.current_value, proposed_value: r.proposed_value, severity: r.severity,
      }));
    })(),

    // Payment trend per customer: the same view and figures as the Payment Behaviour page
    // (last 90 days against the 90 before). 2026-11-18 eval: "how late does Triumph pay now"
    // came back as 29.8 days (the model's own average) instead of the page's 28.0.
    (async () => {
      const { data, error } = await supabase
        .from("v_payment_behaviour_current")
        .select("company_name, payment_terms_days, current_avg_days_late, prior_avg_days_late, delta_days_late, current_on_time_rate, all_time_on_time_rate, current_txn_count, prior_txn_count, deterioration_severity, improvement_severity, volatility_severity, has_sufficient_data")
        .limit(2000);
      if (error) { console.error("payment trend error:", error.message); return; }
      results.payment_trend = data ?? [];
      results.payment_trend_named = companyMentions.length
        ? (data ?? []).filter((r: any) => companyMentions.some((m) => String(r.company_name).toLowerCase().includes(m.toLowerCase())))
        : [];
    })(),

    // Open receivables by invoice currency, summed here (FX exposure questions).
    (async () => {
      const { data, error } = await supabase.from("invoices").select("currency, currency_amount, outstanding_amount").gt("outstanding_amount", 0).limit(10000);
      if (error) { console.error("currency totals error:", error.message); return; }
      const by = new Map<string, { currency: string; invoices: number; usd: number; local: number }>();
      for (const r of (data ?? []) as any[]) {
        const k = r.currency ?? "USD";
        const e = by.get(k) ?? { currency: k, invoices: 0, usd: 0, local: 0 };
        e.invoices += 1; e.usd += Number(r.outstanding_amount ?? 0); e.local += r.currency_amount != null ? Number(r.currency_amount) : NaN; by.set(k, e);
      }
      results.currency_totals = [...by.values()].sort((a, b) => b.usd - a.usd);
    })(),

    // Exposure by country, summed here (sector has its own section).
    (async () => {
      const { data, error } = await supabase.from("customers").select("country_code, current_exposure, credit_limit").eq("lifecycle_status", "active").limit(5000);
      if (error) { console.error("country totals error:", error.message); return; }
      const by = new Map<string, { country: string; customers: number; exposure: number; limit: number }>();
      for (const r of (data ?? []) as any[]) {
        const k = r.country_code ?? "Unknown";
        const e = by.get(k) ?? { country: k, customers: 0, exposure: 0, limit: 0 };
        e.customers += 1; e.exposure += Number(r.current_exposure ?? 0); e.limit += Number(r.credit_limit ?? 0); by.set(k, e);
      }
      results.country_totals = [...by.values()].sort((a, b) => b.exposure - a.exposure);
    })(),

    // Customers in bankruptcy: those with pre-petition (frozen) invoices, summed here.
    (async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("outstanding_amount, customers!inner(company_name, lifecycle_status)")
        // No is_demo filter: invoices carry is_demo = false in the demo too, like the
        // other invoice queries here (2026-11-17: the filter returned no customers).
        .eq("status", "pre_petition").gt("outstanding_amount", 0).limit(2000);
      if (error) { console.error("bankruptcy list error:", error.message); return; }
      const by = new Map<string, { company_name: string; pre_petition: number; invoices: number }>();
      for (const r of (data ?? []) as any[]) {
        const n = r.customers?.company_name ?? "Unknown";
        const e = by.get(n) ?? { company_name: n, pre_petition: 0, invoices: 0 };
        e.pre_petition += Number(r.outstanding_amount ?? 0); e.invoices += 1; by.set(n, e);
      }
      results.bankruptcy = [...by.values()].sort((a, b) => b.pre_petition - a.pre_petition);
    })(),

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
        .is("archived_at", null)
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
      // Everything the Customers page and the customer drawer show (2026-11-18 eval: payment
      // terms, account manager and invoicing currency were answered "I don't have that").
      const selectFields = "id, company_name, company_type, credit_limit, current_exposure, credit_rating_score, credit_rating_raw, credit_rating_source, credit_rating_previous_score, credit_rating_updated_at, financials_fye, scenario, risk_tags, payment_on_time_rate, payment_trend, payment_health, payment_avg_days_early_late, payment_terms_days, invoicing_currency, account_manager, credit_manager, sector, industry, country_code, city, customer_since, contract_expiry, preferred_customer, primary_products, last_reviewed";

      if (companyMentions.length > 0) {
        // Specific company names mentioned — targeted name search
        const nameFilter = companyMentions.map(w => `company_name.ilike.%${w}%`).join(",");
        const { data: named, error: namedErr } = await supabase
          .from("customers")
          .select(selectFields)
          .eq("lifecycle_status", "active")
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
          .eq('lifecycle_status', 'active')
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
        // The ranking returns a few columns only; add the rest of each customer's fields
        // (country, terms, currency, managers…) so portfolio questions see them too.
        const ranked = (data ?? []) as any[];
        const ids = ranked.map((r) => r.id).filter(Boolean);
        if (ids.length) {
          const { data: more } = await supabase.from("customers").select(selectFields).in("id", ids);
          const byId = new Map((more ?? []).map((m: any) => [m.id, m]));
          results.customers = ranked.map((r) => ({ ...(byId.get(r.id) ?? {}), ...r }));
        } else {
          results.customers = ranked;
        }
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
          .eq("lifecycle_status", "active")
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
          .eq("lifecycle_status", "active")
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
          .eq("lifecycle_status", "active")
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
          .eq("lifecycle_status", "active")
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

// Constant-time string comparison for the internal-test-secret check below.
// Not defending against a realistic threat here (public edge function on
// shared, cold-starting infra — network+runtime jitter swamps any timing
// signal a naive === could leak, and the bypassed value is a soft demo
// cost-control limit, not an auth boundary) — but it's ~10 dependency-free
// lines that close the question permanently rather than leave it open.
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
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

  const { mode = "briefing", question, force_refresh = false, customer_id, skip_briefing = false } = body;
  // The question this one follows (a related-question click): a follow-up such as "and their
  // payments?" names no company, so the earlier question's company and sector carry over.
  // A thread (the CIA page's conversation): the last three turns, trimmed, as context.
  const history = (Array.isArray(body.history) ? body.history : []).slice(-3)
    .map((h) => ({ question: String(h?.question ?? "").slice(0, 500), answer: String(h?.answer ?? "").slice(0, 1000) }))
    .filter((h) => h.question && h.answer);
  const previousQuestion = typeof body.previous_question === "string" ? body.previous_question.slice(0, 500)
    : history.length ? history[history.length - 1].question : "";

  // Production (DEMO_MODE not "true"): questions need a signed-in CreditPilot user (the
  // answers read the whole portfolio with the service role); a briefing run needs the
  // scheduler or a signed-in admin / credit manager. The demo keeps its per-IP limit.
  if (!DEMO_MODE) {
    if (mode === "question" || mode === "suggestions" || mode === "shared") {
      const testSecret = Deno.env.get("CIA_INTERNAL_TEST_SECRET") ?? "";
      if (!sameSecret(req.headers.get("x-internal-test-secret") ?? "", testSecret)) {
        try { await requireUser(req); }
        catch (e) { return jsonRes({ error: e instanceof AuthError ? e.message : "Sign in required" }, e instanceof AuthError ? e.status : 401); }
      }
    } else if (mode !== "onboarding") {
      const notAllowed = await agentCallerProblem(req);
      if (notAllowed) return notAllowed;
    }
  }

  // ── SHARED mode: an answer opened from its share link (/share/<id>) ─────────
  // Only answers cia-agent wrote are stored (cia_answers), so a link never shows text a
  // visitor supplied other than the question. Open in the public demo; a signed-in user in
  // production (checked above).
  if (mode === "shared") {
    const id = String(body.answer_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonRes({ error: "Unknown answer" }, 404);
    const { data, error } = await supabaseClient.from("cia_answers").select("question, answer, created_at")
      .eq("id", id).eq("is_demo", DEMO_MODE).maybeSingle();
    if (error) return jsonRes({ error: "Could not open the answer" }, 500);
    if (!data) return jsonRes({ error: "This answer was not found" }, 404);
    return jsonRes(data);
  }

  // ── ONBOARDING mode (New Customer Onboarding) ─────────────────────────────
  // Turns a finished onboarding proposal into a NEW_CREDIT_LIMIT pending action,
  // keeping CIA the only writer of pending_actions. Called by the onboarding
  // function with the signed-in user's token. Separate from the briefing path:
  // prospects never enter the portfolio briefing (their events are published
  // already processed) and nothing here grants a limit.
  if (mode === "onboarding") {
    try {
      await requireUser(req, ["admin", "credit_manager", "credit_analyst"]);
      if (!body.application_id) return jsonRes({ error: "application_id is required" }, 400);
      return jsonRes(await createOnboardingAction(supabaseClient, body.application_id, { isDemo: DEMO_MODE }));
    } catch (e) {
      if (e instanceof AuthError) return jsonRes({ error: e.message }, e.status);
      return jsonRes({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

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

    // Server-side rate limit — the only prior protection was a client-side
    // sessionStorage counter (CIA.tsx), trivially bypassed by a new tab,
    // incognito, or calling this endpoint directly. Placed before
    // extractQuestionEntities below (a live Anthropic call regardless of
    // DEMO_MODE) so a rejected request costs zero API calls, not just skips
    // the main answer call. demoQuestionCount stays in scope through the
    // success return further down so it can be reported back either way.
    //
    // Internal test bypass: a real shared-secret bypass for internal tooling
    // (e.g. the CIA regression harness, tests/cia/run.mjs), checked before
    // (and independent of) the DEMO_MODE branch below — not tied to any
    // specific question count, so it stays correct if the harness or the
    // daily limit changes size independently of each other.
    const testSecret = Deno.env.get("CIA_INTERNAL_TEST_SECRET");
    const providedSecret = req.headers.get("x-internal-test-secret");
    const isInternalTest = !!testSecret && !!providedSecret && timingSafeEqualStr(providedSecret, testSecret);

    const DEMO_QUESTION_LIMIT = 10;
    let demoQuestionCount: number | null = null;
    if (DEMO_MODE && !isInternalTest) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      try {
        const { data: count, error: rateLimitError } = await supabaseClient.rpc(
          "fn_increment_ip_question_count",
          { p_ip_address: ip }
        );
        if (rateLimitError) throw rateLimitError;
        demoQuestionCount = count as number;
      } catch (err) {
        // Fail open — a rate-limit DB hiccup shouldn't take down the demo.
        console.error("Rate limit check failed, allowing request:", err);
      }

      if (demoQuestionCount !== null && demoQuestionCount > DEMO_QUESTION_LIMIT) {
        return jsonRes({
          answer: `You've reached the demo's daily limit of ${DEMO_QUESTION_LIMIT} questions per visitor. This demo runs on real Anthropic API tokens, which cost money per question. To ask unlimited questions, deploy your own instance with your own Anthropic API key — see the [GitHub repo](https://github.com/larsewallin/creditpilot) for setup (about 5 minutes).`,
          sources: [],
          confidence: "Low",
          confidence_reason: "Demo question limit reached.",
          relatedQuestions: [],
          demo_question_count: demoQuestionCount,
        });
      }
    }

    // CIA v2 (2026-11-18): with stream: true the answer arrives as server-sent events, so the
    // page shows each step ("Reading 86 customers…", "Searching the web: …") and the text as it
    // is written; the last event (done) carries the same payload as the JSON answer.
    let emit: (event: string, data: unknown) => void = () => {};
    const step = (label: string) => emit("step", { label });

    const runQuestion = async (): Promise<Response> => {
    try {

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    step("Understanding the question");
    // Extract table routing, company mentions, and sector via a dedicated LLM call
    // (falls back to the old regex logic on any failure) — replaces the regex-only
    // routeQuestion call as the primary path.
    const entities = await extractQuestionEntities(anthropic, question);
    let { tables, company_mentions: companyMentions, sector } = entities;
    if (previousQuestion && companyMentions.length === 0 && !sector) {
      const prev = await extractQuestionEntities(anthropic, previousQuestion);
      if (prev.company_mentions.length || prev.sector) {
        companyMentions = prev.company_mentions;
        sector = prev.sector;
        tables = new Set([...tables, ...prev.tables]);
      }
    }

    if (companyMentions.length) step(`Looking up ${companyMentions.slice(0, 3).join(", ")}${companyMentions.length > 3 ? "…" : ""}`);
    // Fetch data from all relevant tables in parallel
    const data = await fetchRelevantData(supabaseClient, question, tables, DEMO_MODE, companyMentions, sector);
    {
      const n = (a: unknown[] | null | undefined, one: string, many: string) => a?.length ? `${a.length} ${a.length === 1 ? one : many}` : null;
      const read = [n(data.customers, "customer", "customers"), n(data.invoices, "invoice", "invoices"), n(data.payment_transactions, "payment", "payments"),
        n(data.credit_events, "credit event", "credit events"), n(data.negative_news, "news story", "news stories"), n(data.sec_filings, "SEC filing", "SEC filings")].filter(Boolean);
      step(read.length ? `Reading ${read.join(", ")}` : "Reading the portfolio");
    }

    // Build context string — sanitize all text fields to prevent JSON parse errors
    // in Claude's response (quotes, backslashes, newlines in DB fields break output JSON)
    const contextParts: string[] = [];
    // Named customers whose accounts are missing or old: the next steps must ask for them.
    const accountsNeeded: string[] = [];

    // Populated alongside contextParts: tag -> record, so citations the model makes
    // inline (e.g. [E3]) can be mechanically verified against real provided rows.
    const tagMap = new Map<string, TagLookupEntry>();

    // Hoisted out of the customers block below (which is otherwise its own scope)
    // so it's still reachable after Call 1, when the {{HIGH_UTILIZATION_LIST}}
    // marker (if present) gets spliced with this exact, already-correct data.
    // Complete payment-trend lists, spliced in for {{PAYMENT_WORSE_LIST}} / {{PAYMENT_BETTER_LIST}}
    // (2026-11-18 eval: the model listed 10 of 21 "getting worse" customers).
    let paymentWorseBlock = "";
    let paymentBetterBlock = "";
    let highUtilizationLines: { tag: string; company_name: string | null; credit_limit: number | null; current_exposure: number | null }[] = [];

    // Hoisted for the same reason as highUtilizationLines above: still reachable
    // after Call 1, when the {{HIGH_RISK_LIST}} marker (if present) gets spliced
    // with this exact, already-correct data rather than trusting free-text
    // enumeration of up to dozens of names.
    let highRiskLines: { tag: string; customer: any; line: string }[] = [];

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
          line: `- [${tag}] ${sanitize(c.company_name)} (type:${sanitize(c.company_type)}, credit_limit=$${c.credit_limit?.toLocaleString()}, balance=$${c.current_exposure?.toLocaleString()}, utilization=${c.credit_limit ? Math.round(c.current_exposure / c.credit_limit * 100) : "N/A"}%, ${c.credit_rating_score != null ? `credit_score=${c.credit_rating_score}/100 (${sanitize(c.credit_rating_raw) || "N/A"} from ${sanitize(c.credit_rating_source) || "N/A"})` : "credit_score=NR (No Rating, provider=N/A)"}, ${c.financials_fye ? `financials_year_end=${String(c.financials_fye).slice(0, 10)}, ` : ""}${c.credit_rating_previous_score != null ? `previous_credit_score=${c.credit_rating_previous_score}/100${c.credit_rating_updated_at ? ` (score changed ${String(c.credit_rating_updated_at).slice(0, 10)})` : ""}, ` : ""}payment_terms=${c.payment_terms_days != null ? `net ${c.payment_terms_days} days` : "N/A"}, invoicing_currency=${sanitize(c.invoicing_currency) || "N/A"}, ${c.payment_avg_days_early_late != null ? `avg_days_late=${c.payment_avg_days_early_late}, ` : ""}account_manager=${sanitize(c.account_manager) || "N/A"}, credit_manager=${sanitize(c.credit_manager) || "N/A"}, sector=${sanitize(c.sector) || "N/A"}${c.industry ? ` (${sanitize(c.industry)})` : ""}, country=${sanitize(c.country_code) || "N/A"}${c.city ? ` (${sanitize(c.city)})` : ""}, ${c.customer_since ? `customer_since=${String(c.customer_since).slice(0, 10)}, ` : ""}${c.contract_expiry ? `contract_expiry=${String(c.contract_expiry).slice(0, 10)}, ` : ""}${c.last_reviewed ? `last_reviewed=${String(c.last_reviewed).slice(0, 10)}, ` : ""}${c.preferred_customer ? "preferred_customer=yes, " : ""}${c.primary_products ? `products=${sanitize(c.primary_products)}, ` : ""}scenario=${sanitize(c.scenario) || "N/A"}, payment_health=${sanitize(c.payment_health) || "unknown"}, risk_tags=[${(c.risk_tags ?? []).map(sanitize).join(", ")}]${c.is_high_risk ? ', RISK_FLAG=HIGH' : ''})`,
        };
      });

      // Structural reinforcement of the RISK_FLAG=HIGH prompt instruction: an unmissable,
      // dedicated section pushed first, listing the locked V1 high-risk set by itself so
      // it can't get lost in a long customer table or out-competed by credit_events content.
      highRiskLines = customerLines.filter(({ customer }) => customer.is_high_risk);
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

      // How much of its limit a named customer uses, and whether it is over, computed here
      // (2026-11-19: "is that more than their limit allows?" got "Yes" at 92%).
      if (companyMentions.length) {
        const namedLimit = customerLines.filter(({ customer: c }) =>
          companyMentions.some((m) => String(c.company_name ?? "").toLowerCase().includes(m.toLowerCase())));
        const rows = namedLimit.slice(0, 10).flatMap(({ tag, customer: c }) => {
          const bal = Number(c.current_exposure), lim = Number(c.credit_limit);
          if (!Number.isFinite(bal) || !Number.isFinite(lim) || lim <= 0) return [];
          const diff = lim - bal;
          return [`- [${tag}] ${sanitize(c.company_name)}: balance $${bal.toLocaleString()} of a $${lim.toLocaleString()} limit, ${Math.round((bal / lim) * 1000) / 10}% used — ${diff >= 0 ? `UNDER the limit, $${diff.toLocaleString()} still available` : `OVER the limit by $${(-diff).toLocaleString()}`}`];
        });
        if (rows.length) contextParts.push("## LIMIT USE — NAMED CUSTOMER(S) (computed in code; whether a customer is over or under its limit comes from here)\n" + rows.join("\n"));
      }

      // Financial statements of the customer(s) the question names, computed here: the basis
      // for "ask for the latest accounts" in the next steps (2026-11-18: Arconic, score 58,
      // no accounts on file, got "I don't have that information" instead).
      if (companyMentions.length && data.financials_settings) {
        const asOf = new Date().toISOString().slice(0, 10);
        const named = customerLines.filter(({ customer: c }) =>
          companyMentions.some((m) => String(c.company_name ?? "").toLowerCase().includes(m.toLowerCase())));
        if (named.length && named.length <= 10) {
          for (const { customer: c } of named) {
            const age = financialsAge(c.financials_fye ? String(c.financials_fye) : undefined, asOf, c.credit_rating_score ?? undefined, data.financials_settings);
            if (!age || age.status !== "current") accountsNeeded.push(`${sanitize(c.company_name)} (${!age ? "none on file" : age.status === "stale" ? "out of date" : "due soon"})`);
          }
          contextParts.push(
            "## FINANCIAL STATEMENTS — NAMED CUSTOMER(S) (computed in code from the year end on file and the accounts-age limits in Settings)\n" +
            named.map(({ tag, customer: c }) => {
              const age = financialsAge(c.financials_fye ? String(c.financials_fye) : undefined, asOf, c.credit_rating_score ?? undefined, data.financials_settings);
              if (!age) return `- [${tag}] ${sanitize(c.company_name)}: no financial statements on file (no year end recorded) — suggest asking for the latest annual accounts`;
              return `- [${tag}] ${sanitize(c.company_name)}: accounts for the year ended ${age.fye}, ${age.months} months old, limit ${age.max_months} months for this score — ${age.status === "stale" ? "OUT OF DATE, suggest asking for newer accounts" : age.status === "due_soon" ? "due soon, suggest asking for newer accounts" : "current"}`;
            }).join("\n"));
        }
      }
    }

    if (data.score_sources) contextParts.push(...scoreSourceBlocks(data.score_sources));
    if (data.pending_actions) {
      const pa = data.pending_actions;
      // A reduction lowers a limit; a "new limit" (no current value, or a higher one) is not one
      // (2026-11-18: an overview said 20 reductions where 19 lowered a limit and 1 set a new one).
      const reductions = pa.filter((a) => a.action_type === "CREDIT_LIMIT_REDUCTION" && a.current_value != null && a.proposed_value != null && Number(a.proposed_value) < Number(a.current_value));
      const byType = new Map<string, number>();
      for (const a of pa) {
        const t = a.action_type === "CREDIT_LIMIT_REDUCTION" && !reductions.includes(a) ? "NEW_OR_HIGHER_CREDIT_LIMIT" : a.action_type;
        byType.set(t, (byType.get(t) ?? 0) + 1);
      }
      const cut = reductions.reduce((t, a) => t + (Number(a.current_value) - Number(a.proposed_value)), 0);
      contextParts.push(
        `## OFFICIAL PENDING ACTIONS (computed in code, the complete list of proposed actions waiting for approval on the Actions page; use the count and total here, never count or add yourself)\n` +
        `- Waiting for approval: ${pa.length}\n` +
        `- Of which credit limit reductions: ${reductions.length}, together lowering limits by $${cut.toLocaleString()}\n` +
        `- By type: ${[...byType.entries()].map(([t, n]) => `${t} ${n}`).join(", ")}\n` +
        pa.map((a) => `- ${sanitize(a.company_name)}: ${a.action_type}${a.current_value != null ? `, from $${Number(a.current_value).toLocaleString()}` : ""}${a.proposed_value != null ? ` to $${Number(a.proposed_value).toLocaleString()}` : ""}${a.severity ? `, ${a.severity}` : ""}`).join("\n")
      );
    }
    if (data.currency_totals && data.currency_totals.length) {
      contextParts.push(
        `## OFFICIAL OPEN RECEIVABLES BY CURRENCY (computed in code from every open invoice; the answer to "FX exposure by currency". Non-USD amounts are FX exposure; whether they are hedged is in the FX events)\n` +
        `- TOTAL in currencies other than USD (the FX exposure): $${data.currency_totals.filter((c) => c.currency !== "USD").reduce((t, c) => t + c.usd, 0).toLocaleString()}\n` +
        data.currency_totals.map((c) => `- ${sanitize(c.currency)}: ${c.invoices} open invoice${c.invoices === 1 ? "" : "s"}, $${c.usd.toLocaleString()} in USD${c.currency !== "USD" && Number.isFinite(c.local) ? ` (${c.local.toLocaleString()} ${sanitize(c.currency)})` : ""}`).join("\n")
      );
    }
    if (data.country_totals && data.country_totals.length) {
      contextParts.push(
        `## OFFICIAL EXPOSURE BY COUNTRY (computed in code from every active customer; the answer to "exposure to customers in <country>"; never add customers yourself)\n` +
        data.country_totals.map((c) => `- ${sanitize(c.country)}: ${c.customers} customer${c.customers === 1 ? "" : "s"}, balance $${c.exposure.toLocaleString()}, credit limits $${c.limit.toLocaleString()}`).join("\n")
      );
    }
    if (data.payment_trend && data.payment_trend.length) {
      const pt = data.payment_trend as any[];
      const pct = (v: unknown) => v == null ? "N/A" : `${Math.round(Number(v) * 1000) / 10}%`;
      const row = (r: any) => `- ${sanitize(r.company_name)}: last 90 days ${r.current_avg_days_late ?? "N/A"} days late on average (${r.current_txn_count ?? 0} payments) vs ${r.prior_avg_days_late ?? "N/A"} in the 90 days before (${r.prior_txn_count ?? 0}); change ${r.delta_days_late != null ? (Number(r.delta_days_late) > 0 ? "+" : "") + r.delta_days_late : "N/A"} days; on time ${pct(r.current_on_time_rate)} recently, ${pct(r.all_time_on_time_rate)} all time; terms net ${r.payment_terms_days ?? "N/A"}${r.deterioration_severity ? `; getting worse (${r.deterioration_severity})` : ""}${r.improvement_severity ? `; improving (${r.improvement_severity})` : ""}${r.volatility_severity ? `; erratic (${r.volatility_severity})` : ""}`;
      const named = (data.payment_trend_named ?? []) as any[];
      const worse = pt.filter((r) => r.deterioration_severity).sort((a, b) => Number(b.delta_days_late ?? 0) - Number(a.delta_days_late ?? 0));
      const better = pt.filter((r) => r.improvement_severity).sort((a, b) => Number(a.delta_days_late ?? 0) - Number(b.delta_days_late ?? 0));
      const erratic = pt.filter((r) => r.volatility_severity);
      const listLine = (r: any) => `- **${sanitize(r.company_name)}**: ${r.prior_avg_days_late ?? "N/A"} → ${r.current_avg_days_late ?? "N/A"} days late on average (${Number(r.delta_days_late ?? 0) > 0 ? "+" : ""}${r.delta_days_late ?? "N/A"} days; last 90 days vs the 90 before)`;
      paymentWorseBlock = worse.length
        ? `**${worse.length} customer${worse.length === 1 ? "" : "s"} paying later than before** (most change first):\n${worse.map(listLine).join("\n")}`
        : "No customers are paying later than before.";
      paymentBetterBlock = better.length
        ? `**${better.length} customer${better.length === 1 ? "" : "s"} paying earlier than before:**\n${better.map(listLine).join("\n")}`
        : "No customers are paying earlier than before.";
      contextParts.push(
        `## OFFICIAL PAYMENT TREND (computed in code; the same figures as the Payment Behaviour page: last 90 days against the 90 days before. Use these for "how late does X pay now / before", "on-time rate", "whose payments are getting worse / better / erratic". These lists are complete.)\n` +
        (named.length ? `Named customer(s):\n${named.map(row).join("\n")}\n` : "") +
        `Getting worse (${worse.length}):\n${worse.map(row).join("\n") || "- none"}\n` +
        `Improving (${better.length}):\n${better.map(row).join("\n") || "- none"}\n` +
        `Erratic (${erratic.length}): ${erratic.map((r) => sanitize(r.company_name)).join(", ") || "none"}`
      );
    }
    if (data.bankruptcy) {
      const b = data.bankruptcy;
      contextParts.push(
        `## OFFICIAL BANKRUPTCY LIST (computed in code: every customer with pre-petition invoices, i.e. in bankruptcy, with its frozen pre-petition balance; the complete answer to "which customers are in bankruptcy")\n` +
        `- Customers in bankruptcy: ${b.length}, frozen pre-petition AR $${b.reduce((t, x) => t + x.pre_petition, 0).toLocaleString()}\n` +
        b.map((x) => `- ${sanitize(x.company_name)}: $${x.pre_petition.toLocaleString()} pre-petition (${x.invoices} invoice${x.invoices === 1 ? "" : "s"})`).join("\n")
      );
    }

    if (data.ar_aging_portfolio_summary) {
      const s = data.ar_aging_portfolio_summary;
      // Total overdue is summed here, never by the model (CLAUDE.md: no LLM arithmetic over
      // several records). 2026-11-17 the model added the buckets itself and said $15,878,000
      // instead of $15,635,000.
      const overdueAmount = [s.total_1_30, s.total_31_60, s.total_61_90, s.total_over_90].reduce((a: number, v: unknown) => a + Number(v ?? 0), 0);
      const overdueCount = [s.total_bucket_1_30_count, s.total_bucket_31_60_count, s.total_bucket_61_90_count, s.total_bucket_over_90_count].reduce((a: number, v: unknown) => a + Number(v ?? 0), 0);
      const portfolioOverdue = {
        amount: overdueAmount,
        count: overdueCount,
        pct: Number(s.total_outstanding) > 0 ? Math.round((overdueAmount / Number(s.total_outstanding)) * 1000) / 10 : 0,
      };
      contextParts.push(
        `## OFFICIAL AR AGING PORTFOLIO TOTALS (pre-computed, deterministic — the complete and authoritative answer to any portfolio-wide "total overdue" / "total exposure" / "aging summary" question; do not recompute these by summing individual invoices)\n` +
        `- Current: $${Number(s.total_current ?? 0).toLocaleString()} (${s.pct_current ?? 0}%, ${s.total_current_count ?? "N/A"} invoices)\n` +
        `- 1-30 days overdue: $${Number(s.total_1_30 ?? 0).toLocaleString()} (${s.pct_1_30 ?? 0}%, ${s.total_bucket_1_30_count ?? "N/A"} invoices)\n` +
        `- 31-60 days overdue: $${Number(s.total_31_60 ?? 0).toLocaleString()} (${s.pct_31_60 ?? 0}%, ${s.total_bucket_31_60_count ?? "N/A"} invoices)\n` +
        `- 61-90 days overdue: $${Number(s.total_61_90 ?? 0).toLocaleString()} (${s.pct_61_90 ?? 0}%, ${s.total_bucket_61_90_count ?? "N/A"} invoices)\n` +
        `- 90+ days overdue: $${Number(s.total_over_90 ?? 0).toLocaleString()} (${s.pct_over_90 ?? 0}%, ${s.total_bucket_over_90_count ?? "N/A"} invoices)\n` +
        `- TOTAL OVERDUE (1-30 + 31-60 + 61-90 + 90+, excluding pre-petition): $${portfolioOverdue.amount.toLocaleString()} (${portfolioOverdue.pct}% of total outstanding, ${portfolioOverdue.count} invoices)\n` +
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
          `- ${sanitize(s.company_name)}: current=$${Number(s.current_amount ?? 0).toLocaleString()} (${s.current_count ?? "N/A"} invoices), 1-30=$${Number(s.bucket_1_30 ?? 0).toLocaleString()} (${s.bucket_1_30_count ?? "N/A"} invoices), 31-60=$${Number(s.bucket_31_60 ?? 0).toLocaleString()} (${s.bucket_31_60_count ?? "N/A"} invoices), 61-90=$${Number(s.bucket_61_90 ?? 0).toLocaleString()} (${s.bucket_61_90_count ?? "N/A"} invoices), 90+=$${Number(s.bucket_over_90 ?? 0).toLocaleString()} (${s.bucket_over_90_count ?? "N/A"} invoices), TOTAL_OVERDUE=$${[s.bucket_1_30, s.bucket_31_60, s.bucket_61_90, s.bucket_over_90].reduce((a: number, v: unknown) => a + Number(v ?? 0), 0).toLocaleString()}, pre_petition=$${Number(s.pre_petition_amount ?? 0).toLocaleString()}, total_outstanding=$${Number(s.total_outstanding ?? 0).toLocaleString()}, utilization=${s.utilization_pct ?? "N/A"}%, risk_tier=${s.risk_tier ?? "N/A"}, invoice_count=${s.total_invoice_count ?? "N/A"}`
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

    // What CIA may suggest, and the data CreditPilot does not track yet (cia_playbook.ts).
    const advice = isAdviceQuestion(question);
    if (advice) contextParts.push(playbookBlock(capabilityStatus()) + (accountsNeeded.length
      ? `\nRequired step (include it in Suggested next steps): ask ${accountsNeeded.join(", ")} for the latest annual accounts, then re-score.` : ""));

    const context = contextParts.join("\n\n");

    const model = DEMO_MODE ? "claude-haiku-4-5" : "claude-sonnet-5";
    // Live web research (Perplexity for trade credit): for a question about named companies, a
    // sector, or what is happening now. The ledger stays the source of every figure about our
    // own customers; the web adds outside context, cited to its pages. CIA_WEB_SEARCH=off stops it.
    const useWeb = (Deno.env.get("CIA_WEB_SEARCH") ?? "on") !== "off" && (
      companyMentions.length > 0 || !!sector ||
      /\b(news|latest|recent(ly)?|why|market|industry|sector|economy|economic|tariffs?|outlook|happening|today|this (week|month)|going on|headwinds?|rates?|recession|bankrupt\w*|lawsuit|strike|layoffs?)\b/i.test(question));
    // A list answer with its citation tags runs long: at 600 tokens one was cut off mid-list
    // (2026-11-18 eval). A cut answer is also closed off cleanly below.
    const maxTokens = DEMO_MODE ? 1200 : 1500;

    try {
      // ── Call 1: plain-text answer — never embedded in JSON ──────────────────
      step(useWeb ? "Checking the web for current news" : "Writing the answer");
      let wroteStep = !useWeb;
      const answerMessage = await streamClaude(Deno.env.get("ANTHROPIC_API_KEY")!, {
        model,
        max_tokens: maxTokens,
        ...(useWeb ? { tools: [WEB_SEARCH_TOOL] } : {}),
        system: (useWeb ? `You can search the web (at most twice) for current news and context about the companies, sector or topic in the question. Use the web only for outside context: news, markets, the industry, the economy. Every figure about our own customers (exposure, limits, invoices, payments, scores, events) comes from the data below, never from the web. Facts from web pages are cited automatically: do not add tags to them. Search only when the question is about something outside our data or about what is happening now; then answer with our data first and the outside context after. ` : "") + `You are the Credit Intelligence Agent (CIA) for CreditPilot — a credit analyst answering questions about a B2B trade credit portfolio. Answer ONLY from the data provided. Every record in the data below has a bracketed reference tag (e.g. [E3], [C7], [N1]). After each specific factual claim, cite the exact tag(s) supporting it in brackets immediately after the claim, e.g. "utilization is 91.7% [E3]" or "flagged by two agents [E3, N1]". Cite every tag that supports each claim, using multiple tags when multiple records support one claim. Always cite tags individually, comma-separated — never use a dash or range between two tags (e.g. write [P1, P2, P3], never [P1–P3]). Only ever cite tags that actually appear in the data provided — never invent a tag. These tags become numbered source links the user can open, so cite precisely: the record that supports each claim. Be specific with exact amounts, dates, and percentages. When asked broadly which customers are highest-risk or most at-risk across the whole portfolio (not about one named customer), do not name individual customers, a count, or combined totals yourself from the OFFICIAL HIGH-RISK CUSTOMER LIST section — reproducing that list from memory is unreliable once it has more than a few entries. Instead, write one brief intro sentence acknowledging the question, then insert the exact literal text {{HIGH_RISK_LIST}} alone, on its own line — the real list, with combined exposure and credit limit, will be inserted automatically afterward. You may add supporting detail from credit_events after the marker, but never substitute a different framing (e.g. ranking by most recent event, or by utilization percentage alone) for the complete high-risk list. If the question does not call for the complete list (e.g. it's about one named customer, or unrelated to portfolio-wide risk ranking), do not include the placeholder at all. When asked broadly whether any customers are approaching or over their credit limit (not about one named customer), do not name individual customers, percentages, or a count yourself from the OFFICIAL HIGH-UTILIZATION CUSTOMER LIST section — reproducing that list from memory is unreliable. Instead, write one brief intro sentence acknowledging the question, then insert the exact literal text {{HIGH_UTILIZATION_LIST}} alone, on its own line — the real list will be inserted automatically afterward. If the question does not call for the complete list (e.g. it's about one named customer, or unrelated to utilization or credit-limit proximity), do not include the placeholder at all. For portfolio-wide AR aging or total-exposure questions (not about one named customer), use the pre-computed totals in the OFFICIAL AR AGING PORTFOLIO TOTALS section directly (for "total overdue", its TOTAL OVERDUE line; never add the buckets yourself) — never re-derive these totals by summing individual invoice line items yourself, since manual summation across many records is unreliable. For a "biggest", "largest", or "highest" exposure question (singular framing implying one customer, e.g. "what's my biggest portfolio exposure" or "which customer has the largest exposure") — as distinct from a "total exposure" or "total outstanding" question (aggregate framing, not about one customer) — lead the answer with the single customer carrying the largest individual exposure, scanning the CUSTOMERS TABLE's current_exposure figures to identify it; use the OFFICIAL AR AGING PORTFOLIO TOTALS figure only as supporting context afterward, never as the headline figure. For a named customer's AR aging totals, use the OFFICIAL AR AGING TOTALS — NAMED CUSTOMER(S) section the same way. For a sector-wide AR aging or total-overdue question (e.g. "total overdue for the aerospace sector"), use the OFFICIAL AR AGING SECTOR TOTAL section directly — never sum the per-customer rows above it or the raw INVOICES TABLE yourself. Use the raw INVOICES TABLE only to name or describe specific individual invoices when asked, not to recompute aggregate totals. When a question names two or more specific companies and asks for a combined or total figure across them, use the OFFICIAL COMBINED TOTAL — NAMED CUSTOMERS section directly, never sum the CUSTOMERS TABLE rows yourself. For a sector-wide total exposure or credit limit question (e.g. "total exposure to the aerospace sector"), use the OFFICIAL SECTOR EXPOSURE TOTAL section directly, never sum the CUSTOMERS TABLE rows yourself. For a named customer's payment history (average days to pay, on-time rate, total paid), use the pre-computed figures in the OFFICIAL PAYMENT BEHAVIOR TOTALS section directly — never re-derive them by averaging or summing the raw PAYMENT TRANSACTIONS TABLE yourself; use that raw table only to list or describe specific individual transactions when asked. For a sector-wide payment behavior question (e.g. "average days to pay for the aerospace sector"), use the OFFICIAL PAYMENT BEHAVIOR SECTOR TOTAL section directly, never average or sum the per-customer rows above it yourself. For a portfolio-wide payment behavior question (e.g. "average days to pay across the whole portfolio", not about one named customer or sector), use the OFFICIAL PAYMENT BEHAVIOR PORTFOLIO TOTALS section directly, never average or sum the raw PAYMENT TRANSACTIONS TABLE or per-customer rows yourself. For questions asking which customers are flagged by multiple agents, or about multi-signal convergence, use the OFFICIAL MULTI-SIGNAL CONVERGENCE LIST section directly — it's the complete, authoritative answer computed over the full 90-day window; never infer convergence by counting agents per customer from the raw CREDIT EVENTS TABLE yourself, since that table is not guaranteed to include every qualifying event. For questions about where customers' credit scores come from (which provider or source), use the OFFICIAL SCORE SOURCE SUMMARY section directly; for questions about how old customers' financial statements are or whose are out of date, use the OFFICIAL ACCOUNTS AGE LIST section directly — never count customers or compute ages yourself. For questions about proposed actions or what is waiting for approval, use the OFFICIAL PENDING ACTIONS section. For how late a named customer pays now versus before, or its on-time rate, use the OFFICIAL PAYMENT TREND section. When asked broadly which customers' payments are getting worse (paying later), write one brief intro sentence, then the exact literal text {{PAYMENT_WORSE_LIST}} alone on its own line; for which are improving (paying earlier), {{PAYMENT_BETTER_LIST}}; the complete list is inserted automatically, so do not name those customers yourself. For exposure by country, use the OFFICIAL EXPOSURE BY COUNTRY section. For FX exposure by currency, use the OFFICIAL OPEN RECEIVABLES BY CURRENCY section. For questions about which customers are in bankruptcy, use the OFFICIAL BANKRUPTCY LIST section (not the scenario field). For a summary or overview of the portfolio, do not insert {{HIGH_RISK_LIST}} or {{HIGH_UTILIZATION_LIST}}: give counts and totals from the OFFICIAL sections in the length asked for. A customer's credit score comes from Keen or a third-party rating the company chose; never call a score change a rating agency action. Never write the name of a data section (anything starting with OFFICIAL, or words like [pending actions]) in the answer; the only brackets you write are record tags such as [E3]. Lead with the direct answer from the data. When the question asks for a decision or advice (should we, can we, extend terms, raise a limit, collateral, what to do), give the facts that bear on it (score and what it means, utilization, overdue invoices, payment trend, recent events, how old the financial statements are), then end with a section headed **Suggested next steps** with 2–3 short bullets taken from the NEXT STEPS PLAYBOOK section, in CreditPilot first; if the FINANCIAL STATEMENTS section says the customer's accounts are missing, out of date or due soon, one step is to ask for the latest annual accounts. If part of the question is about something the data does not have (e.g. collateral), say so in one short plain clause ("CreditPilot doesn't track collateral yet") and answer the rest; never open the answer with what is missing, never ask the user for information, and never raise things CreditPilot does not track when the user did not ask about them. Never mention the playbook or any data section by name. Never propose a specific new credit limit amount or new payment terms yourself: point to the proposed action if one is waiting, or say to raise in steps. Only if the data has nothing at all on the question, say exactly: I don't have that information in the current data. Do NOT characterize a customer's relationship status (active, inactive, outside the portfolio, former, prospect, etc.) unless the data explicitly states it. Every company in the customers table is a current customer. If you don't know a customer's relationship status, don't mention it — just present the facts. Never use the words 'supplier', 'suppliers', 'vendor', 'vendors', or any 'tier-N' phrasing (tier-1, tier-2, etc.) anywhere in your response. This applies to ALL uses — including generic plurals like 'multiple suppliers' or 'aerospace suppliers', industry-structure descriptions like 'Tier-1 supplier', and any other context. Refer to companies in the customers table only as 'customers', 'companies', or 'accounts'. The word 'supplier' must never appear in your output. Keep response under 120 words (an advice answer with its Suggested next steps: under 170). Exception: if the question asks to list, enumerate, or itemize individual records (e.g. every invoice, every transaction) rather than a summary, pull from the specific raw data table (not aggregate event summaries) and list up to 15 individual items with their specific values — this may exceed 120 words. If more than 15 matching records exist, list the first 15 and state the total count. This exception also applies to questions asking which customers or companies meet a broad criterion across the whole portfolio (e.g. "highest risk", "over their credit limit", "in the aerospace sector") — name every matching customer completely, even if that exceeds 120 words; do not truncate or cap this type of complete-set answer. Use markdown with **bold key terms**. Plain text output only — no JSON.`,
        messages: [
          // The conversation so far: earlier questions and the answers given (no data with them;
          // the data below is read fresh for this question).
          ...history.flatMap((h) => [{ role: "user", content: h.question }, { role: "assistant", content: h.answer }]),
          {
          role: "user",
          content: `${previousQuestion && !history.length ? `Earlier question in this conversation: ${previousQuestion}\n` : ""}Question: ${question}\n\nData:\n${context || "No relevant data found."}`,
        }],
      }, {
        onText: (t) => {
          if (!wroteStep) { wroteStep = true; step("Writing the answer"); }
          emit("delta", { text: t });
        },
        // After a web search the answer starts again: "Writing the answer" follows the search.
        onStep: (label) => { wroteStep = false; step(label); },
        onReset: () => emit("reset", {}),
      });
      const webSources: WebSource[] = answerMessage.web;
      let rawAnswerText = answerMessage.text
        // "I don't have that information…" is for an answer with nothing else in it; when the
        // advice answer goes on, the opening only says what is missing (2026-11-18 eval, Kaman
        // insurance). A lookup about an unknown company keeps it (harness q8).
        .replace(advice ? /^\s*I don't have that information in the current data\.?\s*(?=\S[\s\S]{40,})/ : /(?!)/, "")
        // A list marker must stand on its own line: the model sometimes wraps it in
        // brackets or puts it mid-sentence ("over their limit [{{HIGH_UTILIZATION_LIST}}].").
        .replace(/\s*[\[(]\s*(\{\{\s*[A-Z_]+\s*\}\})\s*[\])]\.?/g, "\n\n$1\n")
        .replace(/([^\n])[ \t]*(\{\{\s*[A-Z_]+\s*\}\})/g, "$1\n\n$2")
        // A tag closed with the wrong bracket ("$600,000 [C1)]" in the 2026-11-19 eval).
        .replace(/\[((?:[CIPNFEUMW]\d+\s*,\s*)*[CIPNFEUMW]\d+)\)\]?/g, "[$1]");
      if (answerMessage.stop_reason === "max_tokens") {
        // Drop the unfinished last line (often half a citation tag) and say it was cut.
        rawAnswerText = rawAnswerText.replace(/\n[^\n]*$/, "").trimEnd() +
          "\n\n_The answer was cut short. Ask about fewer customers or a narrower period for the rest._";
      }

      // ── Deterministic list splice: if the model decided this question calls for
      // the complete high-utilization list, it emits the marker instead of naming
      // customers/percentages/a count itself (both unreliable at this scale). Replace
      // it here, before tag verification/stripping runs, with a block built directly
      // from highUtilizationLines — including real [tag] citations from tagMap, so
      // the existing (unmodified) verification/stripping/sources pipeline below picks
      // them up exactly like any other citation, with nothing to special-case.
      const utilSplicedText = HIGH_UTIL_MARKER_TEST.test(rawAnswerText)
        ? rawAnswerText.replace(HIGH_UTIL_MARKER_REPLACE, buildHighUtilizationListBlock(highUtilizationLines))
        : rawAnswerText;
      const riskSplicedText = HIGH_RISK_MARKER_TEST.test(utilSplicedText)
        ? utilSplicedText.replace(HIGH_RISK_MARKER_REPLACE, buildHighRiskListBlock(highRiskLines))
        : utilSplicedText;
      const answerText = riskSplicedText
        .replace(/\{\{\s*PAYMENT_WORSE_LIST\s*\}\}/g, paymentWorseBlock || "No payment trend data.")
        .replace(/\{\{\s*PAYMENT_BETTER_LIST\s*\}\}/g, paymentBetterBlock || "No payment trend data.");

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

      // Numbered citations, as on an answer engine: every verified record tag and every web
      // page becomes [1], [2]… in order of first use (the same record keeps its number), each
      // one a source the user can open. Unverified tags are dropped. Marked ⟦n⟧ until the
      // clean-up below is done, so no rule there touches them.
      const citeNumber = new Map<string, number>();
      const citeOrder: string[] = [];
      const numberedText = answerText.replace(/\[([^\]]+)\]/g, (full, inner: string) => {
        const pieces = inner.split(",").map((p) => p.trim());
        if (!pieces.every((p) => /^[CIPNFEUMW]\d+(\s*[-–—]\s*[CIPNFEUMW]?\d+)?$/.test(p))) return full;
        const nums: number[] = [];
        for (const p of pieces) {
          const ok = /^W\d+$/.test(p) ? Number(p.slice(1)) <= webSources.length : tagMap.has(p);
          if (!ok) continue;
          let n = citeNumber.get(p);
          if (n === undefined) { n = citeOrder.length + 1; citeNumber.set(p, n); citeOrder.push(p); }
          if (!nums.includes(n)) nums.push(n);
        }
        return nums.map((n) => `⟦${n}⟧`).join("");
      });

      // Stripping is intentionally more permissive than verification: a lone tag or a
      // tag-range (e.g. "P1-P8", "P1–8") is still tag-shaped and should never leak into
      // the visible answer as a raw artifact, even though a range is never treated as a
      // verified citation (citedTags/verifiedTags above stay strict, unchanged).
      const tagOrRangePattern = /^[CIPNFEUM]\d+(\s*[-–—]\s*[CIPNFEUM]?\d+)?$/;

      const cleanAnswerText = numberedText
        .replace(/\[([^\]]+)\]/g, (full, inner) =>
          inner.split(",").every((p: string) => tagOrRangePattern.test(p.trim()) || /^OFFICIAL\b/.test(p.trim())) ? "" : full
        )
        // Section names the model sometimes cites ("[OFFICIAL AR AGING PORTFOLIO TOTALS]")
        // are internal labels, never shown to the user (seen 2026-11-17).
        .replace(/\s*\[(?:[^\]]*OFFICIAL[^\]]*|pending actions?|bankruptcy list|multi-signal convergence list|high-risk customer list)\]/gi, "")
        // Any other all-caps label in brackets is a section name too ("[AR AGING PORTFOLIO TOTALS]", "[PENDING_ACTIONS]").
        .replace(/\s*\[[A-Z][A-Z0-9 _&()—–\-,]{3,}\](?!\()/g, "")
        // Bold markers left empty around a removed tag ("**[I1]**" -> "****").
        .replace(/\*{4}\s?/g, "")
        // Section sub-labels cited like sources ("(Getting worse list)").
        .replace(/\s*[\[(](?:getting worse|improving|erratic|named customer\(s\)|high-risk|high-utilization)(?: list)?[\])]/gi, "")
        // A customer's name used as a citation ("… 40 days late [Arconic Corporation]"): the
        // numbered sources already say where it came from (2026-11-19).
        .replace(/\s*\[([^\]\n]{2,80})\](?!\()/g, (full: string, inner: string) => {
          const name = inner.trim().toLowerCase();
          const known = [...(data.customers ?? []), ...(data.payment_trend_named ?? []), ...(data.ar_aging_customer_summary ?? [])]
            .some((c: any) => String(c?.company_name ?? "").toLowerCase() === name);
          return known ? "" : full;
        })
        // Anything else in brackets is the model's own aside ("[critical priority]"): parentheses read better.
        .replace(/\[([^\]\n]{2,80})\](?!\()/g, "($1)")
        // Section names in prose ("Based on the OFFICIAL MULTI-SIGNAL CONVERGENCE LIST, …").
        .replace(/\b(?:based on|according to|per|from) the \*{0,2}OFFICIAL [A-Z0-9 &()—–\-]+?\*{0,2}(?: data| section| list| figures)?(?:,|:)\s*/gi, "")
        .replace(/\*{0,2}OFFICIAL [A-Z0-9 &()—–\-]+[A-Z)]\*{0,2}/g, "the data")
        // The playbook is an internal name ("The playbook is clear: keep or shorten terms…").
        .replace(/\b(?:the|our) (?:next[- ]steps )?playbook (?:is clear|says|suggests|recommends)[:,]?\s*/gi, "Standard practice: ")
        .replace(/\b(?:per|from|according to) the (?:next[- ]steps )?playbook,?\s*/gi, "")
        // Event type codes ("FX_EXPOSURE_FLAG") in plain words.
        .replace(/\b([A-Z]{2,}(?:_[A-Z0-9]{2,})+)\b/g, (code: string) =>
          code.split("_").map((w, i) => ["FX", "AR", "SEC", "CEO"].includes(w) ? w : i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase()).join(" "))
        .replace(/(^|\n)([ \t*]*)([a-z])/g, (_m, a: string, b: string, c: string) => a + b + c.toUpperCase())
        // Agents by their readable names, not their internal ones.
        .replace(/\b(ar_aging|payment_behaviour|news_monitor|sec_monitor|credit_rating|industry_risk|country_risk|fx_risk|risk)_agent\b/g, (_m, a: string) =>
          ({ ar_aging: "AR aging", payment_behaviour: "payments", news_monitor: "news", sec_monitor: "SEC filings", credit_rating: "credit score",
             industry_risk: "industry", country_risk: "country", fx_risk: "FX", risk: "risk" } as Record<string, string>)[a] ?? a)
        .replace(/\s+([.,;:!?])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        // A citation sits right after the words it supports: "…91.7%[1][2]."
        .replace(/\s+⟦/g, "⟦")
        .trim();
      // For the checks below, the answer without its citation numbers.
      const plainAnswerText = cleanAnswerText.replace(/⟦\d+⟧/g, "");
      const finalAnswerText = cleanAnswerText.replace(/⟦(\d+)⟧/g, "[$1]");

      // ── Call 2: structured metadata only — small JSON, no embedded answer ───
      step("Checking every figure against the data");
      let meta: { confidence: string; confidence_reason: string } = {
        confidence: "Medium",
        confidence_reason: "See answer for details",
      };
      let metaMessage: Anthropic.Message | undefined;
      try {
        metaMessage = await anthropic.messages.create({
          model: DEMO_MODE ? "claude-haiku-4-5" : "claude-sonnet-5",
          max_tokens: 4000,
          system: `Return ONLY valid JSON, no other text. You are grading an answer about a B2B trade credit portfolio.

The grade reflects whether the answer's claims are supported by the data provided, nothing else.

- High: every specific claim in the answer (companies, scores, percentages, scenarios, risk tags, event types, dates) maps to a row in one of the provided tables or to a listed web page the answer cites (live web research is a normal source, never a reason to lower the grade; an answer may rest on web pages alone when our data has nothing on the question). Outside context from the web (news, markets, the industry, the economy) is not graded against the data: only the figures about our own customers are. Drawing facts from multiple tables (customers + credit_events) is normal and does NOT reduce the grade. Absence of credit_events for some companies does NOT reduce the grade — no negative events on file is a positive state, not missing data.
- Medium: the answer makes at least one specific claim (an event type, an alert, a severity, a date, a name) that does not appear in any provided table.
- Low: the answer relies primarily on inference, uncited outside knowledge, or speculation rather than the data and the cited web pages.

RELATIONSHIP-QUALIFIER CHECK: If the answer characterizes a customer's relationship status using words like 'outside', 'not in', 'outside the portfolio', 'outside our portfolio', 'former customer', 'prospect', 'inactive', or implies they are not a current customer — verify against the data. Every company appearing in the customers table IS a current customer. If the answer uses one of these qualifiers about a company that appears in the customers data provided, set confidence to Medium and explain this specifically in confidence_reason. This rule takes priority over the other rubric tiers.

Do not penalize for: using multiple tables, citing credit_events when available, mentioning companies that have ratings but no credit_events, or any form of cross-table synthesis. These are all good behaviors.

Schema: {"confidence":"High|Medium|Low","confidence_reason":"one plain sentence of at most 25 words for a credit manager saying why; do not list the figures, e.g. 'Every figure comes from the customer records and invoices.' Never name data sections, tables, tags or rubric tiers."}`,
          messages: [{
            role: "user",
            content: `Based on this answer and data, provide confidence and sources.\n\nAnswer: ${plainAnswerText}\n\nData:\n${context}${webSources.length ? `\n\nWeb pages the answer cites (claims from these count as supported):\n${webSources.map((w, i) => `[W${i + 1}] ${w.title} (${w.url}): ${w.cited_text}`).join("\n")}` : ""}`,
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

      // The reason is shown to the user: internal section and table names out (2026-11-18).
      meta.confidence_reason = String(meta.confidence_reason ?? "")
        .replace(/\b(?:the )?\*{0,2}OFFICIAL(?: [A-Z0-9&()—–\-]+)+(?: section)?\*{0,2}/g, "the computed totals")
        .replace(/\b(?:the )?CUSTOMERS TABLE\b/gi, "the customer records")
        .replace(/\b(?:the )?CREDIT EVENTS TABLE\b/gi, "the credit events")
        .replace(/\b(?:the )?INVOICES TABLE\b/gi, "the invoices")
        .replace(/\b(?:the )?PAYMENT TRANSACTIONS TABLE\b/gi, "the payment history")
        .replace(/\b(?:the )?([A-Z][A-Z ]{3,}) TABLE\b/g, (_m, t: string) => `the ${t.toLowerCase()} records`)
        .replace(/\[[A-Z]\d+(?:,\s*[A-Z]\d+)*\]/g, "")
        .replace(/\b(?:High|Medium|Low) tier(?: applies)?[:,]?\s*/gi, "")
        .replace(/\b(?:the )?[A-Z][A-Z ]{3,} section\b/g, "the computed totals")
        .replace(/\b(ar_aging|payment_behaviour|news_monitor|sec_monitor|credit_rating|industry_risk|country_risk|fx_risk)_agent\b/g, (_m, a: string) =>
          ({ ar_aging: "AR aging", payment_behaviour: "payments", news_monitor: "news", sec_monitor: "SEC filings", credit_rating: "credit score",
             industry_risk: "industry", country_risk: "country", fx_risk: "FX" } as Record<string, string>)[a] ?? a)
        .replace(/\b(the [a-z ]+?)(?:, \1)+/g, "$1")
        .replace(/\s{2,}/g, " ").trim()
        .replace(/^./, (c) => c.toUpperCase());
      // One short sentence: the full claim-by-claim audit reads as noise under the answer.
      if (meta.confidence_reason.length > 200) {
        const first = meta.confidence_reason.split(/(?<=[.!?])\s/)[0];
        meta.confidence_reason = first.length <= 200 ? first
          : meta.confidence_reason.slice(0, meta.confidence_reason.lastIndexOf(" ", 190)).replace(/[,;:—–\-\s]+$/, "") + "…";
      }

      // What was read, in plain words (shown under the answer, like an answer engine's steps).
      const searched = [
        data.customers?.length ? `${data.customers.length} customer record${data.customers.length === 1 ? "" : "s"}` : null,
        data.invoices?.length ? `${data.invoices.length} invoice${data.invoices.length === 1 ? "" : "s"}` : null,
        data.payment_transactions?.length ? `${data.payment_transactions.length} payment${data.payment_transactions.length === 1 ? "" : "s"}` : null,
        data.credit_events?.length ? `${data.credit_events.length} credit event${data.credit_events.length === 1 ? "" : "s"}` : null,
        data.negative_news?.length ? `${data.negative_news.length} news stor${data.negative_news.length === 1 ? "y" : "ies"}` : null,
        data.sec_filings?.length ? `${data.sec_filings.length} SEC filing${data.sec_filings.length === 1 ? "" : "s"}` : null,
        data.pending_actions?.length ? `${data.pending_actions.length} proposed action${data.pending_actions.length === 1 ? "" : "s"}` : null,
      ].filter(Boolean) as string[];

      // ── Call 3: related questions ────────────────────────────────────────────
      let relatedQuestions = DEMO_SUGGESTIONS.slice(0, 3); // fallback
      try {
        const followUpMessage = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 150,
          system: `Generate exactly 3 short follow-up questions a credit manager would ask after reading this answer. Return ONLY a JSON array of 3 strings. Questions must be specific to the companies and issues mentioned, and each must name the company it is about. Only ask what CreditPilot's data can answer: ${ANSWERABLE_TOPICS}. Never ask about collateral, guarantees, letters of credit, credit insurance, bank data, contracts, orders, or what the customer said.`,
          messages: [{
            role: "user",
            content: `Question: ${question}\nAnswer just given: ${plainAnswerText.slice(0, 700)}\n\nGenerate 3 follow-up questions.`,
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
      type CiaSource = {
        n: number;
        event_id?: string;
        source_type: "credit_events" | "negative_news" | "sec_filings" | "customers" | "invoices" | "payment_transactions" | "web";
        customer_name: string;
        event_type: string | null;
        severity: string | null;
        date: string | null;
        agent: string | null;
        url?: string;
        title?: string;
        cited_text?: string;
      };
      const sources: CiaSource[] = [];
      citeOrder.forEach((tag, i) => {
        const n = i + 1;
        if (/^W\d+$/.test(tag)) {
          const w = webSources[Number(tag.slice(1)) - 1];
          let host = w.url;
          try { host = new URL(w.url).hostname.replace(/^www\./, ""); } catch { /* keep the url */ }
          sources.push({ n, source_type: "web", customer_name: host, event_type: null, severity: null, date: null, agent: null, url: w.url, title: w.title, cited_text: w.cited_text });
          return;
        }
        const entry = tagMap.get(tag)!;
        const eventId = (entry.table === "credit_events" || entry.table === "negative_news") ? entry.id : entry.customer_id;
        sources.push({
          n,
          event_id: eventId ?? undefined,
          source_type: entry.table,
          customer_name: entry.customer_name ?? "",
          event_type: entry.event_type,
          severity: entry.severity,
          date: entry.date,
          agent: entry.agent,
        });
      });

      const payload: Record<string, unknown> = {
        answer: finalAnswerText,
        sources,
        confidence: meta.confidence,
        confidence_reason: meta.confidence_reason,
        relatedQuestions,
        // The customers the question names, for the actions under the answer (open the customer,
        // decide its proposed action).
        customers: companyMentions.length
          ? (data.customers ?? []).filter((c: any) => companyMentions.some((m) => String(c.company_name ?? "").toLowerCase().includes(m.toLowerCase())))
              .slice(0, 3).map((c: any) => ({ id: c.id, company_name: c.company_name }))
          : [],
        // Small charts computed in code from the rows read (never by the model).
        charts: (() => { try { return buildCharts({ question, companyMentions, ...data }); } catch (e) { console.error("[cia-agent] charts:", e); return []; } })(),
        searched: answerMessage.searches.length ? [...searched, `the web (${answerMessage.searches.map((q) => `“${q}”`).join(", ")})`] : searched,
        ...(DEMO_MODE ? { demo_question_count: demoQuestionCount } : {}),
      };
      // Kept for its share link (/share/<id>); never for the harness or the eval.
      if (!isInternalTest) {
        try {
          const { demo_question_count: _count, ...stored } = payload;
          const { data: saved, error: saveErr } = await supabaseClient.from("cia_answers")
            .insert({ is_demo: DEMO_MODE, question: question.slice(0, 1000), answer: stored }).select("id").single();
          if (saveErr) throw saveErr;
          payload.answer_id = saved.id;
        } catch (e) {
          console.error("[cia-agent] answer not stored:", e instanceof Error ? e.message : e);
        }
      }
      return jsonRes(payload);
    } catch (err) {
      console.error("Question mode inner error (Anthropic):", err);
      return jsonRes({ error: "Failed to generate answer", detail: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : String(err).slice(0, 300) }, 500);
    }

    } catch (outerErr) {
      console.error("Question mode outer error:", outerErr instanceof Error ? outerErr.message : String(outerErr));
      return jsonRes({ error: "Question mode failed", detail: outerErr instanceof Error ? outerErr.message : String(outerErr) }, 500);
    }
    };

    if (body.stream !== true) return await runQuestion();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    emit = (event, data) => { writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {}); };
    (async () => {
      try {
        const res = await runQuestion();
        const payload = await res.json().catch(() => ({ error: "Failed to generate answer" }));
        emit(res.ok && !payload.error ? "done" : "error", payload);
      } catch (e) {
        emit("error", { error: "Failed to generate answer", detail: e instanceof Error ? e.message : String(e) });
      } finally {
        writer.close().catch(() => {});
      }
    })();
    return new Response(readable, {
      headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
    });
  }

  // ── BRIEFING mode (default) ────────────────────────────────────────────────

  // DEMO_MODE now runs the real briefing/decisioning pipeline below instead of
  // short-circuiting to a hardcoded DEMO_BRIEFING constant. (Fixed 2026-09-30, F0 —
  // previously this returned canned text and never touched agent_runs, credit_events,
  // pending_actions, or customers.risk_tags in demo, so /actions never reflected any
  // agent's real output.) Scoping to demo data is already handled below via
  // `.eq("is_demo", DEMO_MODE)` on the events query and `is_demo: DEMO_MODE` on every
  // write. Two demo-specific guards: the narrative call below uses claude-haiku-4-5
  // instead of claude-opus-4-5 (cost), and external alert delivery (email/Teams/Slack)
  // is skipped entirely in demo (step 6b) regardless of which webhook secrets are set.
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
  // Excludes cia-agent's own prior output (source_agent = 'cia-agent':
  // DAILY_BRIEFING, COMPOSITE_RISK_CRITICAL/ELEVATED) as defense-in-depth --
  // this function must never re-ingest its own synthesis as if it were a
  // fresh sensing-agent signal, regardless of what any caller's reset logic
  // does to cia_processed elsewhere. See demo-actions/index.ts's reset
  // handler (2026-10-02) for the bug this guards against: un-marking these
  // rows there fed cia-agent's own output back into itself as a phantom
  // "agent," inflating agents_flagging counts and pending_actions severity
  // across repeated resets (14 -> 20 -> 20, not stabilizing).
  let eventsQuery = supabaseClient
    .from("credit_events")
    .select("*")
    .eq("cia_processed", false)
    .eq("is_demo", DEMO_MODE)
    .neq("source_agent", "cia-agent")
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

  // 4. Call Claude -- skipped entirely when skip_briefing is set (initDemo.ts
  //    passes this on every reset-triggered call, see CIARequest.skip_briefing
  //    above for why: the briefing text has no UI surface, and everything
  //    reset actually needs -- composite-risk events, pending_actions -- is
  //    computed below independent of this call's output).
  //
  //    When skip_briefing is NOT set (a direct/manual briefing call), this is
  //    the only place real Anthropic tokens get spent on this path, so it's
  //    rate-limited the same way question mode already is (2026-09-13) --
  //    same per-IP-per-day pattern, separate counter table/RPC so the two
  //    limits don't share a budget.
  let briefing = "";
  if (!skip_briefing) {
    const DEMO_RESET_LIMIT = 10;
    if (DEMO_MODE) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      let demoResetCount: number | null = null;
      try {
        const { data: count, error: rateLimitError } = await supabaseClient.rpc(
          "fn_increment_ip_reset_count",
          { p_ip_address: ip }
        );
        if (rateLimitError) throw rateLimitError;
        demoResetCount = count as number;
      } catch (err) {
        // Fail open -- a rate-limit DB hiccup shouldn't take down the demo.
        console.error("Briefing rate limit check failed, allowing request:", err);
      }

      if (demoResetCount !== null && demoResetCount > DEMO_RESET_LIMIT) {
        return jsonRes({
          error: `Demo daily limit of ${DEMO_RESET_LIMIT} full briefings per visitor reached. This runs on real Anthropic API tokens. Deploy your own instance to lift this limit -- see the GitHub repo.`,
        }, 429);
      }
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
    const systemPrompt = buildSystemPrompt(customers ?? []);
    const userPrompt = buildUserPrompt(events as CreditEvent[], customers ?? [], question);

    try {
      const message = await anthropic.messages.create({
        model: DEMO_MODE ? "claude-haiku-4-5" : "claude-opus-4-5",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      briefing = extractText(message);
    } catch (err) {
      console.error("Anthropic API error:", err);
      return jsonRes({ error: "Failed to generate briefing" }, 500);
    }
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

  // Only write the DAILY_BRIEFING row when a briefing was actually generated
  // (skip_briefing=false) -- an empty/placeholder briefing row would just be
  // noise, and this event type has no UI surface anyway (see skip_briefing's
  // doc comment on CIARequest above).
  if (!skip_briefing) {
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
  }

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
    // A new multi-signal assessment supersedes the customer's previous one: archive the
    // older COMPOSITE_RISK_* rows (kept, never deleted) so feeds and CIA answers see one
    // current assessment per customer instead of one per run.
    const reassessed = assessmentEvents.map((e) => e.customer_id).filter((id): id is string => !!id);
    if (reassessed.length > 0) {
      const { error: archiveError } = await supabaseClient
        .from("credit_events")
        .update({ archived_at: new Date().toISOString() })
        .eq("source_agent", "cia-agent")
        .in("event_type", ["COMPOSITE_RISK_CRITICAL", "COMPOSITE_RISK_ELEVATED"])
        .eq("is_demo", DEMO_MODE)
        .is("archived_at", null)
        .in("customer_id", reassessed);
      if (archiveError) console.error("Composite archive error:", archiveError.message);
    }
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
    const macroDims = custEvents
      .filter((e: any) => e.event_type === "RISK_CHANGE")
      .reduce((m: number, e: any) => Math.max(m, Number(e.payload?.dimension_count) || 0), 0);

    const riskAssessment = assessCompositeRisk({
      utilization_pct: utilizationPct,
      credit_score: creditScore,
      active_event_types: activeEventTypes,
      active_signal_severities: activeSignalSeverities,
      agents_flagging: agentsSeen,
      on_time_rate: onTimeRate,
      macro_dimension_count: macroDims || undefined,
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

    // Compose and deliver credit action alert to credit team.
    // Skipped entirely in demo (F0, 2026-09-30) — demo customers are fictional and
    // this must never send a real email/Teams/Slack message regardless of which
    // webhook secrets happen to be configured on this project.
    if (!DEMO_MODE) {
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
  }

  if (pendingActions.length > 0) {
    // F5 (2026-10-01, see CreditPilot_Deferred_Backlog.md): before inserting fresh
    // proposals, expire any existing 'pending' row for the same customer_id +
    // action_type (scoped to this run's is_demo value, so a demo run can never touch a
    // real/prod row and vice versa). Without this, a demo reset that flips old rows back
    // to 'pending' (see demo-actions/index.ts) could leave a stale row sitting alongside
    // a freshly-derived one for the same customer/action, or a stale row surviving even
    // when current data would no longer actually trigger that action. 'expired' is an
    // existing value in pending_actions_status_check — this is its first real use.
    for (const action of pendingActions) {
      const { error: expireError } = await supabaseClient
        .from("pending_actions")
        .update({ status: "expired" })
        .eq("customer_id", action.customer_id)
        .eq("action_type", action.action_type)
        .eq("is_demo", action.is_demo)
        .eq("status", "pending");
      if (expireError) console.error("pending_actions expire error:", expireError);
    }

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
    demo: DEMO_MODE,
    briefing,
    events_processed: events.length,
    composite_risks_detected: assessmentEvents.filter(e => e.event_type !== "DAILY_BRIEFING").length,
    pending_actions_created: pendingActions.length,
    stale_agents: staleAgents,
    messages: [{ role: "assistant", content: briefing }],
  });
});
