/**
 * Small charts under a CIA answer. The numbers come from cia-agent (computed in code from the
 * rows read); this only draws them: one horizontal bar per row, the value written beside it.
 */
import { cn } from "@/lib/utils";

export interface ChartRow { label: string; value: number; tone?: "bad" | "good" | "neutral"; display?: string }
export interface Chart { title: string; unit: "usd" | "days" | "pct"; rows: ChartRow[]; note?: string }

const TONE: Record<string, string> = { bad: "bg-red-400", good: "bg-emerald-500", neutral: "bg-slate-400" };

export function AnswerCharts({ charts }: { charts?: Chart[] }) {
  if (!charts?.length) return null;
  return (
    <div className={cn("grid gap-3", charts.length > 1 && "sm:grid-cols-2")}>
      {charts.map((c, i) => {
        const max = Math.max(...c.rows.map((r) => Math.abs(r.value)), 0) || 1;
        return (
          <figure key={i} className="rounded-xl border bg-white p-3 space-y-2">
            <figcaption className="text-xs font-semibold text-gray-800">{c.title}</figcaption>
            <div className="space-y-1.5">
              {c.rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground" title={r.label}>{r.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-2.5 rounded-full bg-gray-100 flex-1 overflow-hidden">
                      <div className={cn("h-full rounded-full", TONE[r.tone ?? "neutral"])} style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} />
                    </div>
                    <span className="tabular-nums text-gray-800 shrink-0">{r.display ?? r.value.toLocaleString("en-US")}</span>
                  </div>
                </div>
              ))}
            </div>
            {c.note && <p className="text-[11px] text-muted-foreground">{c.note}</p>}
          </figure>
        );
      })}
    </div>
  );
}
