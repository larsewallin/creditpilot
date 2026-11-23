/**
 * A CIA answer opened from its share link (/share/<id>): the question, the answer with its
 * numbered sources, its charts, and a way to ask your own question. Open to anyone in the public
 * demo (demo data only); a signed-in user in production (cia-agent checks).
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_MODE } from "@/lib/constants";
import { AnswerMarkdown } from "@/components/cia/AnswerMarkdown";
import { AnswerCharts } from "@/components/cia/AnswerCharts";
import { sourceLabel, agentLabel } from "@/lib/sourceLabels";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CIAAnswer, Source } from "@/pages/CIA";

function host(url?: string) { try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; } }

export default function SharedAnswer() {
  const { id = "" } = useParams();
  const [open, setOpen] = useState<Source | null>(null);
  const q = useQuery({
    queryKey: ["cia-shared", id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("cia-agent", { body: { mode: "shared", answer_id: id } });
      if (error) throw new Error("This answer could not be opened.");
      if (data?.error) throw new Error(data.error);
      return data as { question: string; answer: CIAAnswer; created_at: string };
    },
  });

  if (q.isLoading) return <div className="max-w-[720px] mx-auto py-16 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Opening the answer…</div>;
  if (q.error || !q.data) return <div className="max-w-[720px] mx-auto py-16 text-sm text-destructive">{(q.error as Error)?.message ?? "Not found."}</div>;
  const { question, answer, created_at } = q.data;
  const sources = answer.sources ?? [];

  return (
    <div className="max-w-[720px] mx-auto py-6 space-y-6">
      <p className="text-xs text-muted-foreground">
        A shared answer from CreditPilot's assistant, {new Date(created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{DEMO_MODE ? " · demo data (sample portfolio)" : ""}
      </p>
      <div className="flex justify-end">
        <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-800 max-w-[80%] whitespace-pre-wrap">{question}</div>
      </div>
      <div className="prose prose-base max-w-none text-gray-800 prose-p:leading-relaxed prose-headings:font-semibold prose-headings:text-gray-900 prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-h1:mt-5 prose-h2:mt-5 prose-h1:mb-2 prose-h2:mb-2">
        <AnswerMarkdown answer={{ answer: answer.answer, sources }} onCite={setOpen} plainLinks />
      </div>
      {answer.charts && answer.charts.length > 0 && <AnswerCharts charts={answer.charts} />}
      {sources.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sources</p>
          <ol className="border-t border-gray-100 pt-2 space-y-1 text-sm">
            {sources.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-5">[{s.n ?? i + 1}]</span>
                {s.source_type === "web"
                  ? <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{s.title ?? host(s.url)} <span className="text-muted-foreground">· {host(s.url)}</span></a>
                  : <span className="truncate">{s.customer_name} <span className="text-muted-foreground">· {sourceLabel(s)}</span></span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="rounded-xl border bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" />Ask your own question</p>
          <p className="text-xs text-muted-foreground">The assistant reads the portfolio and the web, and cites every figure.</p>
        </div>
        <Link to="/cia" className="inline-flex items-center rounded-md bg-primary text-primary-foreground text-sm px-3 h-9">Try it</Link>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="sm:max-w-md">
          {open && (
            <>
              <SheetHeader><SheetTitle className="text-base">[{open.n}] {open.source_type === "web" ? open.title : open.customer_name}</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                {open.source_type === "web" ? (
                  <>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="h-3.5 w-3.5" />{host(open.url)}</p>
                    {open.cited_text && <blockquote className="border-l-2 border-sky-300 pl-3 italic">{open.cited_text}</blockquote>}
                    <a href={open.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Open the page<ExternalLink className="h-3.5 w-3.5" /></a>
                  </>
                ) : (
                  <p className="text-xs">{sourceLabel(open)} · {agentLabel(open.agent, open.source_type)}{open.date ? ` · ${new Date(/^\d{4}-\d{2}-\d{2}$/.test(open.date) ? `${open.date}T00:00:00` : open.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
