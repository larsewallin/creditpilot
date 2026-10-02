import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SeverityBadge } from "@/components/SeverityBadge";
import { formatCurrency, relativeTime } from "@/lib/format";
import { SkeletonCard } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ExternalLink, TrendingDown, AlertTriangle } from "lucide-react";
import { DemoDataNotice } from "@/components/DemoDataNotice";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// change_percent on INDUSTRY_DOWNTURN payloads is already sign-normalized to
// the sector's producer/consumer exposure direction by the agent
// (see _shared/skills/analytical/sector-exposure-direction.ts) — negative
// always means deterioration for that sector, never a raw market move. The
// page presents it as-is rather than re-deriving a second opinion.
function formatChange(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  const n = Number(pct);
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// Mirrors severityToScore in supabase/functions/_shared/event_schemas.ts —
// used only to rank a sector's events and surface the single worst one at
// the sector header, never to relabel an individual event's own severity.
const SEVERITY_RANK: Record<string, number> = { critical: 92, high: 75, medium: 52, low: 27, info: 7 };
function worstSeverity(events: { severity: string }[]): string | null {
  if (events.length === 0) return null;
  return events.reduce((worst, e) =>
    (SEVERITY_RANK[e.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0) ? e.severity : worst,
    events[0].severity
  );
}

export default function IndustryRisk() {
  const [searchParams] = useSearchParams();
  const highlightedSector = searchParams.get("sector");

  // Sectors actually present in the portfolio — same filter the
  // industry-risk-agent itself uses (current_exposure > 0, excluding 'Other',
  // which is a catch-all no single indicator applies to).
  const { data: sectors, isLoading } = useQuery({
    queryKey: ["industry-sectors"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("sector, current_exposure")
        .gt("current_exposure", 0);
      const agg = new Map<string, { sector: string; customer_count: number; total_exposure: number }>();
      for (const row of data ?? []) {
        const s = (row as any).sector as string;
        if (!s || s === "Other") continue;
        const existing = agg.get(s) ?? { sector: s, customer_count: 0, total_exposure: 0 };
        existing.customer_count += 1;
        existing.total_exposure += Number((row as any).current_exposure) || 0;
        agg.set(s, existing);
      }
      return [...agg.values()].sort((a, b) => b.total_exposure - a.total_exposure);
    },
  });

  const { data: events } = useQuery({
    queryKey: ["industry-credit-events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("credit_events")
        .select("id, event_type, severity, title, summary, payload, created_at")
        .eq("source_agent", "industry_risk_agent")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: econSignals } = useQuery({
    queryKey: ["seed-industry-econ"],
    queryFn: async () => {
      const { data } = await supabase
        .from("seed_industry_econ_signals")
        .select("sector, indicator, source_series, observation_date, change_percent, period_days");
      return data ?? [];
    },
  });

  const { data: newsSignals } = useQuery({
    queryKey: ["seed-industry-news"],
    queryFn: async () => {
      const { data } = await supabase
        .from("seed_industry_news")
        .select("sector, headline, summary, url, source, published_date, disruption_type");
      return data ?? [];
    },
  });

  // Scroll only once every query backing a card has settled, then wait out one
  // more paint. isLoading covers the sector list alone; the three signal
  // queries resolve independently and each changes card heights when it lands,
  // so an earlier scroll targets a stale offset — or, before first paint, finds
  // no element at all and silently does nothing while the highlight ring still
  // applies (which is what made this easy to miss). The scroll container is
  // <main class="overflow-auto"> in App.tsx's SidebarLayout, not the window;
  // scrollIntoView handles that correctly on its own once the element is
  // actually laid out.
  const signalsReady = !!events && !!econSignals && !!newsSignals;
  useEffect(() => {
    if (!highlightedSector || isLoading || !sectors?.length || !signalsReady) return;
    const t = setTimeout(() => {
      document
        .getElementById(`industry-${encodeURIComponent(highlightedSector)}`)
        ?.scrollIntoView({ behavior: "auto", block: "center" });
    }, 100);
    return () => clearTimeout(t);
  }, [highlightedSector, isLoading, sectors, signalsReady]);

  if (isLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;

  return (
    <div className="space-y-6 pb-48">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Industry Risk</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Sector-level economic and news signals for the industries present in your portfolio.
          These are the only signals not tied to a single customer — they apply to every customer in the sector.
        </p>
      </div>

      <DemoDataNotice message="Economic series IDs (FRED/BLS) are real, but the percentage changes and news headlines shown here are fabricated for this demo and were not published or reported." />

      <div className="space-y-4">
        {(sectors ?? []).map((s) => {
          const sectorEvents = (events ?? []).filter((e: any) => e.payload?.sector === s.sector);
          const downturns = sectorEvents.filter((e: any) => e.event_type === "INDUSTRY_DOWNTURN");
          const disruptions = sectorEvents.filter((e: any) => e.event_type === "INDUSTRY_DISRUPTION");
          const sectorEcon = (econSignals ?? []).filter((x: any) => x.sector === s.sector);
          const sectorNews = (newsSignals ?? []).filter((x: any) => x.sector === s.sector);

          return (
            <div
              key={s.sector}
              id={`industry-${encodeURIComponent(s.sector)}`}
              className={cn(
                "bg-card rounded-xl border overflow-hidden",
                s.sector === highlightedSector && "ring-2 ring-blue-500"
              )}
            >
              <div className="p-4">
                {/* Sector header */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{s.sector}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {s.customer_count} customer{s.customer_count !== 1 ? "s" : ""} ·{" "}
                      {formatCurrency(s.total_exposure)} exposure
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {sectorEvents.length === 0 ? (
                      <Badge variant="secondary" className="text-[10px] h-5">No active signals</Badge>
                    ) : (
                      <>
                        <span className="text-[10px] text-muted-foreground">
                          Highest active signal{sectorEvents.length > 1 ? ` (of ${sectorEvents.length})` : ""}:
                        </span>
                        <SeverityBadge severity={worstSeverity(sectorEvents)} />
                      </>
                    )}
                  </div>
                </div>

                {/* Downturn signals — econ */}
                {downturns.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                      Economic downturn signals
                    </p>
                    <div className="space-y-2">
                      {downturns.map((e: any) => {
                        const p = e.payload ?? {};
                        return (
                          <div key={e.id} className="flex items-start gap-2 bg-agent-industry/5 rounded-lg p-2.5">
                            <TrendingDown className="h-3.5 w-3.5 text-agent-industry mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                                {String(p.indicator ?? "").replace(/_/g, " ")}{" "}
                                <span className="font-mono text-severity-critical">{formatChange(p.change_percent)}</span>
                                <SeverityBadge severity={e.severity} />
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{e.summary}</p>
                              <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                                {p.source_series ?? "—"} · {p.period_days ?? 365}-day comparison ·{" "}
                                {relativeTime(e.created_at)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Disruption signals — news */}
                {disruptions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                      Disruption signals
                    </p>
                    <div className="space-y-2">
                      {disruptions.map((e: any) => {
                        const p = e.payload ?? {};
                        const matchingNews = sectorNews.find((n: any) => e.title?.includes(n.headline));
                        return (
                          <div key={e.id} className="flex items-start gap-2 bg-agent-industry/5 rounded-lg p-2.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-agent-industry mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                                  {matchingNews?.headline ?? e.title}
                                  <SeverityBadge severity={e.severity} />
                                </p>
                                {p.evidence_url && (
                                  (() => {
                                    // Demo mode seeds fabricated headlines against placeholder
                                    // example.com URLs (DemoDataNotice above already says the
                                    // headlines are fabricated) -- an example.com link isn't a
                                    // real article, so don't send the user to a dead link.
                                    // Production's real GDELT-sourced evidence_url still renders
                                    // as a normal clickable link.
                                    let isPlaceholder = false;
                                    try {
                                      isPlaceholder = new URL(p.evidence_url).hostname === "example.com";
                                    } catch {
                                      isPlaceholder = false;
                                    }
                                    if (isPlaceholder) {
                                      return (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="text-muted-foreground/40 shrink-0 cursor-help">
                                              <ExternalLink className="h-3 w-3" />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            Demo data -- no live article to link to.
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    }
                                    return (
                                      <a
                                        href={p.evidence_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    );
                                  })()
                                )}
                              </div>
                              {matchingNews?.summary && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">{matchingNews.summary}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <Badge variant="secondary" className="text-[10px]">
                                  {String(p.disruption_type ?? "other").replace(/_/g, " ")}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground/70">
                                  {matchingNews ? `${matchingNews.source} · ${matchingNews.published_date}` : relativeTime(e.created_at)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Monitored series for this sector, even when nothing fired */}
                {sectorEcon.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                      Monitored indicators
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                      {sectorEcon.map((x: any, i: number) => (
                        <div key={i} className="text-[11px]">
                          <span className="text-muted-foreground">
                            {String(x.indicator).replace(/_/g, " ")}:
                          </span>{" "}
                          <span className="font-mono tabular-nums text-foreground">
                            {formatChange(x.change_percent)}
                          </span>{" "}
                          <span className="text-muted-foreground/60 font-mono">({x.source_series})</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-2">
                      Raw series change. A signal only fires once it's material for this sector's own
                      exposure direction — a price rise hurts a sector that buys the commodity and helps one that sells it.
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
