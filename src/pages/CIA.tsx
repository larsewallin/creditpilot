// src/pages/CIA.tsx
// Perplexity-style CIA answer page

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { DEMO_MODE } from "@/lib/constants";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { agentLabel, sourceLabel } from "@/lib/sourceLabels";
import { askCiaStream } from "@/lib/ciaStream";
import { linkCitations, liveText } from "@/lib/ciaText";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Check, ExternalLink, Globe, Loader2 } from "lucide-react";
import { AnswerCharts, type Chart } from "@/components/cia/AnswerCharts";
import { AnswerActions } from "@/components/cia/AnswerActions";
import { AnswerMarkdown } from "@/components/cia/AnswerMarkdown";
import { AskHome } from "@/components/cia/AskHome";
import { appendTurn, getThread, historyFor, newThreadId, type ThreadTurn } from "@/lib/ciaThread";
import { Plus, Share2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Source {
  /** The citation number in the answer ([1], [2]…), when the answer cites it. */
  n?: number;
  event_id?: string;
  source_type?: "credit_events" | "negative_news" | "sec_filings" | "customers" | "invoices" | "payment_transactions" | "web";
  /** Web pages (live research): the page, its title and the passage cited. */
  url?: string;
  title?: string;
  cited_text?: string;
  customer_name: string;
  event_type: string | null;
  severity: "critical" | "high" | "medium" | "low" | "info" | null;
  date?: string;
  agent: string | null;
  static?: boolean;
}

export interface CIAAnswer {
  answer: string;
  sources: Source[];
  confidence: "High" | "Medium" | "Low";
  confidence_reason: string;
  relatedQuestions?: string[];
  /** What was read for the answer, in plain words ("12 invoices"). */
  searched?: string[];
  /** Small charts computed in code from the rows read. */
  charts?: Chart[];
  /** Set when the demo answered from an answer saved earlier today (same question). */
  saved_at?: string;
  /** The stored answer, for its share link (/share/<id>). */
  answer_id?: string;
  /** The customers the question names (for the actions under the answer). */
  customers?: { id: string; company_name: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function severityDot(severity: string | null) {
  if (severity === "critical" || severity === "high") return "bg-red-500";
  if (severity === "medium") return "bg-amber-400";
  return "bg-gray-300";
}



function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function confidenceDot(confidence: string) {
  if (confidence === "High") return "bg-emerald-500";
  if (confidence === "Medium") return "bg-amber-400";
  return "bg-red-500";
}

function confidenceText(confidence: string) {
  if (confidence === "High") return "text-emerald-700";
  if (confidence === "Medium") return "text-amber-700";
  return "text-red-700";
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AnswerSkeleton({ question }: { question: string }) {
  return (
    <div className="space-y-6">
      {/* Question bubble */}
      <div className="flex justify-end">
        <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-800 max-w-[80%]">
          {question}
        </div>
      </div>

      {/* Loading dots + shimmer lines */}
      <div className="space-y-4 pt-2">
        <div className="flex gap-1 items-center h-5">
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
        <div className="space-y-2.5 animate-pulse">
          <div className="h-4 bg-gray-100 rounded-md w-full" />
          <div className="h-4 bg-gray-100 rounded-md w-3/4" />
          <div className="h-4 bg-gray-100 rounded-md w-full" />
        </div>
      </div>
    </div>
  );
}

// ─── Live steps (CIA v2) ─────────────────────────────────────────────────────

function Steps({ steps, running }: { steps: string[]; running: boolean }) {
  if (!steps.length) return null;
  return (
    <ol className="space-y-1.5 text-sm" aria-live="polite">
      {steps.map((label, i) => {
        const active = running && i === steps.length - 1;
        const web = /web/i.test(label);
        return (
          <li key={i} className={cn("flex items-center gap-2", active ? "text-foreground" : "text-muted-foreground")}>
            {active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
              : web ? <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
              : <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
            <span className="truncate">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function hostOf(url?: string) {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return url ?? ""; }
}

// ─── Fallback suggestions ─────────────────────────────────────────────────────

// Display only — enforcement is entirely server-side (cia-agent, per IP per day).
// Kept here only for the "Demo: N/10" footer text; not read by any logic.
const DEMO_QUESTION_LIMIT = 10;

const DEMO_SUGGESTIONS = [
  "Which customers have the highest credit risk right now?",
  "Are there any customers with overdue invoices above $500k?",
  "Which customers have recent negative news or SEC alerts?",
  "What is the total portfolio exposure to high-risk customers?",
  "Which customers have credit ratings below B+?",
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CIA() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const question = searchParams.get("q") ?? "";
  // Set when the question was a related-question click: the server carries the earlier
  // question's company over to a follow-up that does not name one.
  const previousQuestion = searchParams.get("after") ?? "";
  // The conversation (thread) this question belongs to; earlier turns stack above it.
  const threadId = searchParams.get("t");
  const [earlier, setEarlier] = useState<ThreadTurn[]>([]);
  useEffect(() => {
    if (question && !threadId) {
      const next = new URLSearchParams(searchParams);
      next.set("t", newThreadId());
      navigate(`/cia?${next.toString()}`, { replace: true });
    }
  }, [question, threadId, searchParams, navigate]);

  const [answer, setAnswer] = useState<CIAAnswer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<string[]>([]);
  // Server-derived — set from cia-agent's response (demo_question_count),
  // never guessed locally. null until the first real (non-canned) answer.
  const [demoQuestionCount, setDemoQuestionCount] = useState<number | null>(null);
  // CIA v2: what it is doing, and the answer as it is written.
  const [steps, setSteps] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [openCite, setOpenCite] = useState<Source | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch answer whenever question changes
  useEffect(() => {
    if (!question || !threadId) return;
    const prior = getThread(threadId).filter((x) => x.question !== question);
    setEarlier(prior);
    setAnswer(null);
    setError(null);
    setRelated([]);
    setIsLoading(true);

    setSteps([]);
    setDraft("");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    askCiaStream(
      { mode: "question", question, ...(prior.length ? { history: historyFor(prior) } : previousQuestion ? { previous_question: previousQuestion } : {}) },
      {
        onStep: (label) => setSteps((s) => (s[s.length - 1] === label ? s : [...s, label])),
        onDelta: (t) => setDraft((d) => d + t),
        onReset: () => setDraft(""),
      },
      ctrl.signal,
    )
      .then((data) => {
        if (ctrl.signal.aborted) return;
        if (DEMO_MODE && typeof data?.demo_question_count === "number") setDemoQuestionCount(data.demo_question_count);
        setAnswer(data as unknown as CIAAnswer);
        if (!data?.error) appendTurn(threadId, { question, answer: data as unknown as CIAAnswer });
      })
      .catch((err) => { if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : "Unknown error"); })
      .finally(() => { if (!ctrl.signal.aborted) setIsLoading(false); });
    return () => ctrl.abort();
  }, [question, previousQuestion, threadId]);

  // Use contextual follow-up questions returned with the answer
  useEffect(() => {
    if (!answer) return;
    const questions = Array.isArray(answer.relatedQuestions) && answer.relatedQuestions.length > 0
      ? answer.relatedQuestions
      : DEMO_SUGGESTIONS.slice(0, 3);
    setRelated(questions.filter(s => s !== question).slice(0, 3));
  }, [answer, question]);

  const handleSourceClick = (source: Source) => {
    if (source.static) return;
    if (source.source_type === "web") { if (source.url) window.open(source.url, "_blank", "noopener"); return; }
    if (source.source_type === "negative_news") navigate(`/news?event_id=${source.event_id}`);
    else if (source.source_type === "sec_filings") navigate(`/sec?customer_id=${source.event_id}`);
    else if (source.source_type === "customers" || source.source_type === "invoices" || source.source_type === "payment_transactions") navigate(`/customers?customer_id=${source.event_id}`);
    else navigate(`/events?event_id=${source.event_id}`);
  };

  const handleRelated = (q: string) => {
    navigate(`/cia?q=${encodeURIComponent(q)}&after=${encodeURIComponent(question)}${threadId ? `&t=${threadId}` : ""}`);
  };

  if (!question) return <AskHome />;

  return (
    <div className="max-w-[720px] mx-auto py-6 space-y-8">
      {earlier.length > 0 && (
        <div className="flex justify-end -mb-4">
          <button type="button" onClick={() => navigate("/cia")} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Plus className="h-3.5 w-3.5" />New thread
          </button>
        </div>
      )}
      {earlier.map((turn, i) => {
        const a = turn.answer as unknown as CIAAnswer;
        return (
          <div key={i} className="space-y-4 pb-6 border-b border-gray-100">
            <div className="flex justify-end">
              <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-800 max-w-[80%]">{turn.question}</div>
            </div>
            <div className="prose prose-sm max-w-none text-gray-700 prose-p:leading-relaxed">
              <AnswerMarkdown answer={{ ...a, sources: a.sources ?? [] }} onCite={setOpenCite} />
            </div>
            {a.charts && a.charts.length > 0 && <AnswerCharts charts={a.charts} />}
          </div>
        );
      })}

      {isLoading && (steps.length === 0 && !draft ? <AnswerSkeleton question={question} /> : (
        <div className="space-y-6">
          <div className="flex justify-end">
            <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-800 max-w-[80%]">{question}</div>
          </div>
          <Steps steps={steps} running={!draft} />
          {draft && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Answer</p>
              <div className="border-t border-gray-100 pt-4 prose prose-base max-w-none text-gray-800 prose-p:leading-relaxed prose-strong:text-gray-900 prose-p:text-base">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveText(draft) + " ▍"}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      ))}

      {error && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-800 max-w-[80%]">
              {question}
            </div>
          </div>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {answer && !isLoading && (
        <>
          {/* Question bubble */}
          <div className="flex justify-end">
            <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-800 max-w-[80%] leading-relaxed">
              {question}
            </div>
          </div>

          {/* Answer section */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Answer</p>
            <div className="border-t border-gray-100 pt-4">
              <div className="prose prose-base max-w-none text-gray-800 prose-p:leading-relaxed prose-strong:text-gray-900 prose-p:text-base">
                <AnswerMarkdown answer={answer} onCite={setOpenCite} />
              </div>
              {answer.charts && answer.charts.length > 0 && <div className="mt-4"><AnswerCharts charts={answer.charts} /></div>}
              {answer.customers && answer.customers.length > 0 && <div className="mt-4"><AnswerActions customers={answer.customers} /></div>}
              {answer.answer_id && (
                <div className="mt-3">
                  <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={async () => {
                      const url = `${window.location.origin}/share/${answer.answer_id}`;
                      try { await navigator.clipboard.writeText(url); toast.success(DEMO_MODE ? "Link copied: anyone with it can read this answer" : "Link copied: colleagues signed in to CreditPilot can open it"); }
                      catch { window.prompt("Copy the link:", url); }
                    }}>
                    <Share2 className="h-3.5 w-3.5" />Share this answer
                  </button>
                </div>
              )}
              {steps.length > 0 && (
                <details className="mt-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">{answer.saved_at ? `Answered earlier today at ${new Date(answer.saved_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ` : ""}{steps.length} steps · {answer.searched && answer.searched.length > 0 ? `read ${answer.searched.join(", ")}` : "how this was answered"}</summary>
                  <div className="mt-2"><Steps steps={steps} running={false} /></div>
                </details>
              )}
              {steps.length === 0 && answer.searched && answer.searched.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">Read: {answer.searched.join(", ")}</p>
              )}
            </div>
          </div>

          {/* Sources section */}
          {answer.sources.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sources</p>
              <div className="border-t border-gray-100 pt-3 space-y-2">
                {answer.sources.map((s, i) => (
                  s.static ? (
                    <div
                      key={s.event_id ?? i}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 bg-white text-left"
                    >
                      <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">[{s.n ?? i + 1}]</span>
                      {s.source_type === "web" ? <Globe className="h-3.5 w-3.5 text-sky-700 shrink-0" /> : <span className={cn("w-2 h-2 rounded-full shrink-0", severityDot(s.severity))} />}
                      <span className="text-sm font-medium text-gray-800 truncate">{s.source_type === "web" ? (s.title ?? s.customer_name) : s.customer_name}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-muted-foreground shrink-0">{s.source_type === "web" ? "Web" : agentLabel(s.agent, s.source_type)}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-muted-foreground truncate">{s.source_type === "web" ? hostOf(s.url) : sourceLabel(s)}</span>
                      {s.date && <>
                        <span className="text-gray-300 ml-auto">·</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatDate(s.date)}</span>
                      </>}
                    </div>
                  ) : (
                    <button
                      key={s.event_id ?? i}
                      onClick={() => handleSourceClick(s)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors text-left group"
                    >
                      <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">[{s.n ?? i + 1}]</span>
                      {s.source_type === "web" ? <Globe className="h-3.5 w-3.5 text-sky-700 shrink-0" /> : <span className={cn("w-2 h-2 rounded-full shrink-0", severityDot(s.severity))} />}
                      <span className="text-sm font-medium text-gray-800 truncate">{s.source_type === "web" ? (s.title ?? s.customer_name) : s.customer_name}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-muted-foreground shrink-0">{s.source_type === "web" ? "Web" : agentLabel(s.agent, s.source_type)}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-muted-foreground truncate">{s.source_type === "web" ? hostOf(s.url) : sourceLabel(s)}</span>
                      {s.date && <>
                        <span className="text-gray-300 ml-auto">·</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatDate(s.date)}</span>
                      </>}
                    </button>
                  )
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sources</p>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-sm text-muted-foreground italic">This answer is based on portfolio-level figures rather than specific records, so there are no individual sources to list.</p>
              </div>
            </div>
          )}

          {/* Confidence — always shown when present */}
          {answer.confidence && (
            <div className="space-y-1 pl-1">
              <div className="flex items-center gap-2">
                <span className={cn("text-sm font-medium", confidenceText(answer.confidence))}>
                  Confidence: {answer.confidence}
                </span>
                <span className={cn("w-2 h-2 rounded-full", confidenceDot(answer.confidence))} />
              </div>
              {answer.confidence_reason && (
                <p className="text-xs text-muted-foreground italic">
                  "{answer.confidence_reason}"
                </p>
              )}
            </div>
          )}

          {/* Related questions */}
          {related.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Related questions</p>
              <div className="border-t border-gray-100 pt-3 space-y-1">
                {related.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleRelated(q)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-gray-700 hover:bg-gray-50 transition-colors group"
                  >
                    <span className="text-muted-foreground group-hover:text-foreground transition-colors">→</span>
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Sheet open={!!openCite} onOpenChange={(o) => !o && setOpenCite(null)}>
        <SheetContent className="sm:max-w-md">
          {openCite && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">
                  [{openCite.n}] {openCite.source_type === "web" ? (openCite.title ?? "Web page") : openCite.customer_name}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                {openCite.source_type === "web" ? (
                  <>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="h-3.5 w-3.5" />{hostOf(openCite.url)}</p>
                    {openCite.cited_text && <blockquote className="border-l-2 border-sky-300 pl-3 text-gray-700 italic">{openCite.cited_text}</blockquote>}
                    <a href={openCite.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Open the page<ExternalLink className="h-3.5 w-3.5" /></a>
                  </>
                ) : (
                  <>
                    <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-xs">
                      <dt className="text-muted-foreground">Record</dt><dd>{sourceLabel(openCite)}</dd>
                      <dt className="text-muted-foreground">From</dt><dd>{agentLabel(openCite.agent, openCite.source_type)}</dd>
                      {openCite.severity && <><dt className="text-muted-foreground">Severity</dt><dd className="flex items-center gap-1.5"><span className={cn("w-2 h-2 rounded-full", severityDot(openCite.severity))} />{openCite.severity}</dd></>}
                      {openCite.date && <><dt className="text-muted-foreground">Date</dt><dd>{formatDate(openCite.date)}</dd></>}
                    </dl>
                    {!openCite.static && openCite.event_id && (
                      <button type="button" onClick={() => { const s = openCite; setOpenCite(null); handleSourceClick(s); }} className="inline-flex items-center gap-1 text-primary underline">
                        Open the record<ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {DEMO_MODE && demoQuestionCount !== null && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          Demo: {Math.min(demoQuestionCount, DEMO_QUESTION_LIMIT)}/{DEMO_QUESTION_LIMIT} questions used
        </p>
      )}
    </div>
  );
}
