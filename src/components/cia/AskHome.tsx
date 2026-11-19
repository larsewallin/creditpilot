/**
 * The CIA's home (/cia with no question, and the app's start page): one large question box and
 * questions to try, Perplexity style. The demo leads with the assistant ("come for the tool").
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Globe, Sparkles } from "lucide-react";

const TRY = [
  { q: "Should I reduce Arconic's credit limit?", hint: "Advice with next steps" },
  { q: "What's the latest news on American Airlines, and how exposed are we?", hint: "Searches the web", web: true },
  { q: "Which customers have the highest credit risk right now?", hint: "Portfolio view" },
  { q: "Why is Triumph Group flagged across multiple agents?", hint: "Signals explained" },
  { q: "Whose payments are getting worse?", hint: "With a chart" },
  { q: "What negative news have we seen recently?", hint: "From the news agent" },
];

export function AskHome() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const ask = (text: string) => { const t = text.trim(); if (t) navigate(`/cia?q=${encodeURIComponent(t)}`); };
  return (
    <div className="max-w-[720px] mx-auto pt-16 pb-24 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center justify-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />Ask anything about your receivables
        </h1>
        <p className="text-sm text-muted-foreground">
          The assistant reads your customers, invoices, payments and the monitoring agents' alerts, checks the web for current news,
          and cites every figure it gives you.
        </p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="relative">
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }}
          rows={3}
          autoFocus
          placeholder="e.g. Which customers should I worry about this week?"
          aria-label="Ask a question"
          className="w-full resize-none rounded-2xl border border-input bg-white px-4 py-3 pr-14 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button type="submit" disabled={!q.trim()} aria-label="Ask"
          className="absolute right-3 bottom-3 h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40">
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Try</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TRY.map((t) => (
            <button key={t.q} type="button" onClick={() => ask(t.q)}
              className="text-left rounded-xl border bg-white px-3 py-2.5 hover:border-primary/50 hover:bg-primary/5 transition-colors">
              <span className="block text-sm text-gray-800">{t.q}</span>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                {t.web && <Globe className="h-3 w-3 text-sky-700" />}{t.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
