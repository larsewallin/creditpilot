import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SeverityBadge } from "@/components/SeverityBadge";
import { formatCurrency, relativeTime } from "@/lib/format";
import { SkeletonCard } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AlertTriangle, Activity } from "lucide-react";
import { DemoDataNotice } from "@/components/DemoDataNotice";

const SEVERITY_RANK: Record<string, number> = { critical: 92, high: 75, medium: 52, low: 27, info: 7 };
function worstSeverity(events: { severity: string }[]): string | null {
  if (events.length === 0) return null;
  return events.reduce((w, e) => ((SEVERITY_RANK[e.severity] ?? 0) > (SEVERITY_RANK[w] ?? 0) ? e.severity : w), events[0].severity);
}

const EVENT_ICON: Record<string, any> = {
  FX_EXPOSURE_FLAG: AlertTriangle,
  CURRENCY_VOLATILITY: Activity,
};

function pct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function signed(n: number) {
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatCurrency(Math.abs(n))}`;
}

function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">{children}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function FxRisk() {
  const [searchParams] = useSearchParams();
  const highlighted = searchParams.get("currency");

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["fx-exposure-invoices"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("v_fx_exposure_by_invoice").select("*");
      return (data ?? []) as any[];
    },
  });

  const { data: status } = useQuery({
    queryKey: ["fx-currency-status"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("fx_currency_status").select("*");
      return (data ?? []) as any[];
    },
  });

  const { data: events } = useQuery({
    queryKey: ["fx-credit-events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("credit_events")
        .select("id, event_type, severity, title, summary, payload, created_at")
        .eq("source_agent", "fx_risk_agent")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const ready = !!events && !!status;
  useEffect(() => {
    if (!highlighted || isLoading || !invoices?.length || !ready) return;
    const t = setTimeout(() => {
      document.getElementById(`fx-${highlighted}`)?.scrollIntoView({ behavior: "auto", block: "center" });
    }, 100);
    return () => clearTimeout(t);
  }, [highlighted, isLoading, invoices, ready]);

  if (isLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;

  const byCurrency = new Map<string, any[]>();
  for (const r of invoices ?? []) {
    const list = byCurrency.get(r.currency) ?? [];
    list.push(r);
    byCurrency.set(r.currency, list);
  }
  const currencies = [...byCurrency.entries()]
    .map(([code, rows]) => ({ code, rows, total: rows.reduce((s, r) => s + Number(r.usd_at_booking), 0) }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-6 pb-48">
      <div>
        <h1 className="text-xl font-semibold text-foreground">FX Risk</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Receivables invoiced in a foreign currency. If the currency weakens against the dollar before the customer pays, you collect less.
          Hedged invoices are excluded from the unhedged exposure. CreditPilot flags the exposure; it does not advise on hedging.
        </p>
      </div>

      <DemoDataNotice message="Exchange rates shown here are generated reference data for this demo, not market quotes." />

      <div className="space-y-4">
        {currencies.map(({ code, rows }) => {
          const st = (status ?? []).find((s: any) => s.currency === code);
          const cEvents = (events ?? []).filter((e: any) => e.payload?.currency_code === code);
          const unhedged = rows.filter((r) => !r.fx_hedged);
          const hedged = rows.filter((r) => r.fx_hedged);
          const sum = (a: any[], f: (r: any) => number) => a.reduce((s, r) => s + f(r), 0);
          const unhedgedUsd = sum(unhedged, (r) => Number(r.usd_at_booking));
          const hedgedUsd = sum(hedged, (r) => Number(r.usd_at_booking));
          const delta = sum(unhedged, (r) => Number(r.fx_delta_usd));
          const sens = sum(unhedged, (r) => Number(r.sensitivity_10pct_usd));

          const custMap = new Map<string, { id: string; name: string; unhedged: number; hedged: number; delta: number; nextPay: string }>();
          for (const r of rows) {
            const e = custMap.get(r.customer_id) ?? { id: r.customer_id, name: r.company_name, unhedged: 0, hedged: 0, delta: 0, nextPay: r.expected_pay_date };
            if (r.fx_hedged) e.hedged += Number(r.usd_at_booking);
            else {
              e.unhedged += Number(r.usd_at_booking);
              e.delta += Number(r.fx_delta_usd);
            }
            if (r.expected_pay_date < e.nextPay) e.nextPay = r.expected_pay_date;
            custMap.set(r.customer_id, e);
          }
          const custs = [...custMap.values()].sort((a, b) => b.unhedged - a.unhedged);

          return (
            <div
              key={code}
              id={`fx-${code}`}
              className={cn("bg-card rounded-xl border overflow-hidden", code === highlighted && "ring-2 ring-blue-500")}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{code} <span className="text-muted-foreground font-normal">/ USD</span></p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {custs.length} customer{custs.length !== 1 ? "s" : ""} · {rows.length} open invoice{rows.length !== 1 ? "s" : ""}
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

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                  <Metric label="Unhedged exposure" sub={hedgedUsd > 0 ? `${formatCurrency(hedgedUsd)} hedged` : "nothing hedged"}>
                    {formatCurrency(unhedgedUsd)}
                  </Metric>
                  <Metric label="FX impact since booking" sub="unhedged invoices, USD value">
                    <span className={cn(delta < 0 ? "text-severity-critical" : delta > 0 ? "text-emerald-600" : "")}>{signed(delta)}</span>
                  </Metric>
                  <Metric label="Current rate" sub={st ? `${pct(st.change_30d_pct)} USD value over 30 days` : undefined}>
                    {st ? `${Number(st.rate).toFixed(code === "JPY" ? 2 : 4)} ${code}/USD` : "—"}
                  </Metric>
                  <Metric label="Volatility (annualised)" sub={`a further 10% move = ${formatCurrency(sens)}`}>
                    {st?.volatility_pct != null ? `${Number(st.volatility_pct).toFixed(1)}%` : "—"}
                  </Metric>
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-2">
                  A flag fires on large unhedged exposure; a weakening currency and a long wait for payment raise its severity.
                  Insurance does not cover currency movement.
                </p>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Customer</th>
                        <th className="py-1 pr-3 font-medium text-right">Unhedged</th>
                        <th className="py-1 pr-3 font-medium text-right">Hedged</th>
                        <th className="py-1 pr-3 font-medium text-right">FX impact</th>
                        <th className="py-1 font-medium text-right">Expected pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {custs.map((c) => (
                        <tr key={c.id} className="border-t">
                          <td className="py-1.5 pr-3 text-foreground">{c.name}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(c.unhedged)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{c.hedged > 0 ? formatCurrency(c.hedged) : "—"}</td>
                          <td className={cn("py-1.5 pr-3 text-right tabular-nums", c.delta < 0 ? "text-severity-critical" : c.delta > 0 ? "text-emerald-600" : "")}>
                            {c.unhedged > 0 ? signed(c.delta) : "—"}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">{c.nextPay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {cEvents.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">Active signals</p>
                    <div className="space-y-2">
                      {cEvents.map((e: any) => {
                        const Icon = EVENT_ICON[e.event_type] ?? AlertTriangle;
                        return (
                          <div key={e.id} className="flex items-start gap-2 bg-agent-fx/5 rounded-lg p-2.5">
                            <Icon className="h-3.5 w-3.5 text-agent-fx mt-0.5 shrink-0" />
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
        {currencies.length === 0 && (
          <p className="text-sm text-muted-foreground">No foreign-currency receivables yet. Run the FX agent to load exchange rates.</p>
        )}
      </div>
    </div>
  );
}
