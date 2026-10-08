import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SeverityBadge } from "@/components/SeverityBadge";
import { formatCurrency, relativeTime } from "@/lib/format";
import { SkeletonCard } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Landmark, Percent, ShieldAlert, TrendingDown, Gavel } from "lucide-react";
import { DemoDataNotice } from "@/components/DemoDataNotice";

// Mirrors severityToScore in supabase/functions/_shared/event_schemas.ts —
// used only to pick a country's single worst event for its header badge.
const SEVERITY_RANK: Record<string, number> = { critical: 92, high: 75, medium: 52, low: 27, info: 7 };
function worstSeverity(events: { severity: string }[]): string | null {
  if (events.length === 0) return null;
  return events.reduce((w, e) => ((SEVERITY_RANK[e.severity] ?? 0) > (SEVERITY_RANK[w] ?? 0) ? e.severity : w), events[0].severity);
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function delta(prev: number, cur: number) {
  const d = cur - prev;
  if (d === 0) return <span className="text-muted-foreground">unchanged</span>;
  return (
    <span className={cn("font-mono", d < 0 ? "text-severity-critical" : "text-emerald-600")}>
      {d > 0 ? "+" : ""}{d}
    </span>
  );
}

const EVENT_ICON: Record<string, any> = {
  COUNTRY_RATING_CHANGE: Landmark,
  COUNTRY_POLITICAL_RISK: ShieldAlert,
  COUNTRY_ECONOMIC_SHOCK: TrendingDown,
  INTEREST_RATE_CHANGE: Percent,
  TARIFF_CHANGE: Gavel,
};

function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">{children}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CountryRisk() {
  const [searchParams] = useSearchParams();
  const highlighted = searchParams.get("country");

  // Countries actually present in the portfolio — same filter the agent uses
  // (customers.country_code = company address country, current_exposure > 0).
  const { data: countries, isLoading } = useQuery({
    queryKey: ["country-exposure"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("country_code, current_exposure").gt("current_exposure", 0);
      const agg = new Map<string, { code: string; customer_count: number; total_exposure: number }>();
      for (const row of data ?? []) {
        const code = (row as any).country_code as string;
        if (!code) continue;
        const e = agg.get(code) ?? { code, customer_count: 0, total_exposure: 0 };
        e.customer_count += 1;
        e.total_exposure += Number((row as any).current_exposure) || 0;
        agg.set(code, e);
      }
      return [...agg.values()].sort((a, b) => b.total_exposure - a.total_exposure);
    },
  });

  const { data: events } = useQuery({
    queryKey: ["country-credit-events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("credit_events")
        .select("id, event_type, severity, title, summary, payload, created_at")
        .eq("source_agent", "country_risk_agent")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: metrics } = useQuery({
    queryKey: ["seed-country-risk"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("seed_country_risk").select("*");
      return data ?? [];
    },
  });

  const ready = !!events && !!metrics;
  useEffect(() => {
    if (!highlighted || isLoading || !countries?.length || !ready) return;
    const t = setTimeout(() => {
      document.getElementById(`country-${highlighted}`)?.scrollIntoView({ behavior: "auto", block: "center" });
    }, 100);
    return () => clearTimeout(t);
  }, [highlighted, isLoading, countries, ready]);

  if (isLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;

  return (
    <div className="space-y-6 pb-48">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Country Risk</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Sovereign rating, political and economic risk, policy rates and tariffs for the countries your customers are based in.
          Like industry signals, these are not tied to a single customer — they apply to every customer in the country.
        </p>
      </div>

      <DemoDataNotice message="Country ratings, scores, policy rates and tariff changes shown here are fabricated for this demo and were not published by any agency or central bank." />

      <div className="space-y-4">
        {(countries ?? []).map((c) => {
          const m: any = (metrics ?? []).find((x: any) => x.country_code === c.code);
          const cEvents = (events ?? []).filter((e: any) => {
            const p = e.payload ?? {};
            return p.country_code === c.code || p.origin_country === c.code || (p.affected_countries ?? []).includes(c.code);
          });
          return (
            <div
              key={c.code}
              id={`country-${c.code}`}
              className={cn("bg-card rounded-xl border overflow-hidden", c.code === highlighted && "ring-2 ring-blue-500")}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{m?.country_name ?? countryName(c.code)} <span className="text-muted-foreground font-normal">({c.code})</span></p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {c.customer_count} customer{c.customer_count !== 1 ? "s" : ""} · {formatCurrency(c.total_exposure)} exposure
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {cEvents.length === 0 ? (
                      <Badge variant="secondary" className="text-[10px] h-5">No active signals</Badge>
                    ) : (
                      <>
                        <span className="text-[10px] text-muted-foreground">
                          Highest active signal{cEvents.length > 1 ? ` (of ${cEvents.length})` : ""}:
                        </span>
                        <SeverityBadge severity={worstSeverity(cEvents)} />
                      </>
                    )}
                  </div>
                </div>

                {m && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                    <Metric
                      label={`Sovereign rating (${String(m.rating_agency).toUpperCase()})`}
                      sub={m.previous_rating !== m.current_rating ? `was ${m.previous_rating} · outlook ${m.rating_outlook}` : `outlook ${m.rating_outlook}`}
                    >
                      {m.current_rating}
                    </Metric>
                    <Metric label="Political risk score" sub={<>vs previous: {delta(m.previous_political_score, m.political_score)}</>}>
                      {m.political_score}
                    </Metric>
                    <Metric label="Economic score" sub={<>vs previous: {delta(m.previous_economic_score, m.economic_score)}</>}>
                      {m.economic_score}
                    </Metric>
                    <Metric
                      label={`Policy rate (${m.central_bank})`}
                      sub={Number(m.policy_rate) !== Number(m.previous_policy_rate) ? `was ${Number(m.previous_policy_rate).toFixed(2)}%` : "unchanged"}
                    >
                      {Number(m.policy_rate).toFixed(2)}%
                    </Metric>
                  </div>
                )}
                {m && (
                  <p className="text-[10px] text-muted-foreground/60 mt-2">
                    Scores run 0–100, higher = lower risk. A signal fires on a rating change, a 10+ point score drop, a 25+ bp policy-rate move, or a tariff change.
                  </p>
                )}

                {cEvents.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">Active signals</p>
                    <div className="space-y-2">
                      {cEvents.map((e: any) => {
                        const Icon = EVENT_ICON[e.event_type] ?? ShieldAlert;
                        return (
                          <div key={e.id} className="flex items-start gap-2 bg-agent-country/5 rounded-lg p-2.5">
                            <Icon className="h-3.5 w-3.5 text-agent-country mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                                {e.title}
                                <SeverityBadge severity={e.severity} />
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{e.summary}</p>
                              <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                                {e.event_type} · {relativeTime(e.created_at)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {(countries ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No customers with exposure yet.</p>
        )}
      </div>
    </div>
  );
}
