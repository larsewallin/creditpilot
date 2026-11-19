/** A CIA answer's text with its numbered citations as chips that open the source. */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { linkCitations } from "@/lib/ciaText";
import { sourceLabel } from "@/lib/sourceLabels";
import type { CIAAnswer, Source } from "@/pages/CIA";

export function AnswerMarkdown({ answer, onCite, plainLinks = false }: { answer: Pick<CIAAnswer, "answer" | "sources">; onCite: (s: Source) => void; plainLinks?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => {
          const m = href?.match(/^#cite-(\d+)$/);
          // A shared answer shows other links as text: a share page never sends visitors elsewhere.
          if (!m) return plainLinks ? <span>{children}</span> : <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
          const n = Number(m[1]);
          const src = answer.sources.find((x) => x.n === n) ?? answer.sources[n - 1];
          return (
            <button
              type="button"
              onClick={() => src && onCite(src)}
              title={src ? (src.source_type === "web" ? src.title : `${src.customer_name} · ${sourceLabel(src)}`) : undefined}
              className={cn("not-prose inline-flex items-center justify-center align-super ml-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-semibold leading-none no-underline",
                src?.source_type === "web" ? "bg-sky-100 text-sky-800 hover:bg-sky-200" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}
            >{n}</button>
          );
        },
      }}
    >{linkCitations(answer.answer)}</ReactMarkdown>
  );
}

