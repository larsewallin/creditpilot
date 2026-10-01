import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format";
import { SkeletonCard, SkeletonTable } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState, useEffect, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DemoDataNotice } from "@/components/DemoDataNotice";

// Positive days_early_late = paid late, negative = paid early
// (docs/DEMO_DATA_CONTRACT.md). Render accordingly.
function formatDaysLate(days: number | null): { text: string; className: string } {
  if (days === null || days === undefined) return { text: "—", className: "text-muted-foreground" };
  if (days > 0) return { text: `${days}d late`, className: "text-severity-critical" };
  if (days < 0) return { text: `${Math.abs(days)}d early`, className: "text-risk-current" };
  return { text: "on time", className: "text-risk-current" };
}

function formatDelta(delta: number | null): { text: string; className: string } {
  if (delta === null || delta === undefined) return { text: "—", className: "text-muted-foreground" };
  if (delta > 0) return { text: `+${delta.toFixed(1)}d`, className: "text-severity-critical font-semibold" };
  if (delta < 0) return { text: `${delta.toFixed(1)}d`, className: "text-risk-current font-semibold" };
  return { text: "0.0d", className: "text-muted-foreground" };
}

export default function Payments() {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const highlightedCustomerId = searchParams.get("customer_id");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["payment-behaviour-current"],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_payment_behaviour_current")
        .select("*")
        .order("delta_days_late", { ascending: false, nullsFirst: false });
      return data ?? [];
    },
  });

  // Underlying payment_transactions for whichever customer is expanded.
  const { data: transactions } = useQuery({
    queryKey: ["payment-transactions", expandedId],
    enabled: !!expandedId,
    queryFn: async () => {
      const { data } = await supabase
        .from("payment_transactions")
        .select("id, payment_date, amount_paid, days_early_late, days_to_pay, on_time, payment_method")
        .eq("customer_id", expandedId)
        .order("payment_date", { ascending: false });
      return data ?? [];
    },
  });

  // Deep-link: open + scroll to the customer named in ?customer_id=.
  // Deferred past the paint that follows expanding the row — an immediate
  // scrollIntoView runs before the row exists (or before the expansion has
  // changed the layout) and silently does nothing, while the highlight ring
  // still applies. The scroll container is <main class="overflow-auto"> in
  // App.tsx's SidebarLayout, not the window; scrollIntoView handles that
  // correctly once the element is actually laid out.
  useEffect(() => {
    if (!highlightedCustomerId || isLoading || !rows?.length) return;
    setExpandedId(highlightedCustomerId);
    const t = setTimeout(() => {
      document.getElementById(`payment-${highlightedCustomerId}`)?.scrollIntoView({ behavior: "auto", block: "center" });
    }, 100);
    return () => clearTimeout(t);
  }, [highlightedCustomerId, isLoading, rows]);

  const filtered = (rows ?? []).filter((r: any) =>
    !search || r.company_name?.toLowerCase().includes(search.toLowerCase())
  );

  const deterioratingCount = (rows ?? []).filter((r: any) => r.deterioration_severity).length;
  const volatileCount = (rows ?? []).filter((r: any) => r.volatility_severity).length;
  const improvingCount = (rows ?? []).filter((r: any) => r.improvement_severity).length;

  if (isLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonTable rows={8} /></div>;

  return (
    <div className="space-y-6 pb-48">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Payment Behaviour</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Per-customer payment-timing trend — the last 90 days compared against the 90 days before that.
          Open one from a Credit Events card for context, or browse below.
        </p>
      </div>

      <DemoDataNotice message="Payment transactions shown here are fictional, generated for illustration only. They are not real payment records." />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Customers tracked", value: rows?.length ?? 0, className: "text-foreground" },
          { label: "Deteriorating", value: deterioratingCount, className: "text-severity-critical" },
          { label: "Volatile", value: volatileCount, className: "text-severity-high" },
          { label: "Improving", value: improvingCount, className: "text-risk-current" },
        ].map((tile) => (
          <div key={tile.label} className="bg-card rounded-xl border p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{tile.label}</p>
            <p className={cn("text-2xl font-bold mt-1", tile.className)}>{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Payment Timing by Customer
        </h2>
        <Input
          placeholder="Search customers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48 h-8 text-xs"
        />
      </div>

      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50">
              <tr className="text-muted-foreground">
                <th className="text-left p-3 font-medium w-8" />
                <th className="text-left p-3 font-medium whitespace-nowrap">Customer</th>
                <th className="text-right p-3 font-medium whitespace-nowrap">Last 30d avg</th>
                <th className="text-right p-3 font-medium whitespace-nowrap">Prior 30d avg</th>
                <th className="text-right p-3 font-medium whitespace-nowrap">Change</th>
                <th className="text-right p-3 font-medium whitespace-nowrap">Volatility</th>
                <th className="text-right p-3 font-medium whitespace-nowrap">On-time</th>
                <th className="text-left p-3 font-medium whitespace-nowrap">Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r: any) => {
                const isExpanded = expandedId === r.customer_id;
                const delta = formatDelta(r.delta_days_late === null ? null : Number(r.delta_days_late));
                return (
                  <Fragment key={r.customer_id}>
                    <tr
                      id={`payment-${r.customer_id}`}
                      onClick={() => setExpandedId(isExpanded ? null : r.customer_id)}
                      className={cn(
                        "hover:bg-secondary/30 transition-colors cursor-pointer",
                        r.customer_id === highlightedCustomerId && "ring-2 ring-blue-500"
                      )}
                    >
                      <td className="p-3 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                      <td className="p-3">
                        <span className="font-medium text-foreground">{r.company_name}</span>
                        <span className="block text-[10px] text-muted-foreground">{r.sector}</span>
                      </td>
                      {r.has_sufficient_data ? (
                        <>
                          <td className="p-3 text-right font-mono tabular-nums">
                            <span className={formatDaysLate(Number(r.current_avg_days_late)).className}>
                              {Number(r.current_avg_days_late).toFixed(1)}d
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums text-muted-foreground">
                            {Number(r.prior_avg_days_late).toFixed(1)}d
                          </td>
                          <td className={cn("p-3 text-right font-mono tabular-nums", delta.className)}>{delta.text}</td>
                          <td className="p-3 text-right font-mono tabular-nums text-muted-foreground">
                            {r.current_stddev_days === null ? "—" : `${Number(r.current_stddev_days).toFixed(1)}d`}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums text-muted-foreground">
                            {r.current_on_time_rate === null ? "—" : `${(Number(r.current_on_time_rate) * 100).toFixed(0)}%`}
                          </td>
                        </>
                      ) : (
                        <td className="p-3 text-muted-foreground italic" colSpan={5}>
                          Not enough payment history in both windows to compare
                        </td>
                      )}
                      <td className="p-3">
                        <div className="flex gap-1 flex-wrap">
                          {r.deterioration_severity && (
                            <Badge variant="secondary" className="text-[10px] bg-severity-critical/10 text-severity-critical">
                              Deteriorating
                            </Badge>
                          )}
                          {r.improvement_severity && (
                            <Badge variant="secondary" className="text-[10px] bg-risk-current/10 text-risk-current">
                              Improving
                            </Badge>
                          )}
                          {r.volatility_severity && (
                            <Badge variant="secondary" className="text-[10px] bg-agent-payment/10 text-agent-payment">
                              Volatile
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-secondary/20">
                        <td colSpan={8} className="p-4">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                            Payment history — {r.company_name}
                            {r.payment_terms_days ? ` · net ${r.payment_terms_days} terms` : ""}
                            {" · "}exposure {formatCurrency(r.current_exposure)}
                          </p>
                          {(transactions ?? []).length === 0 ? (
                            <p className="text-xs text-muted-foreground">No payment transactions on record.</p>
                          ) : (
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="text-left py-1.5 font-medium">Payment date</th>
                                  <th className="text-right py-1.5 font-medium">Amount</th>
                                  <th className="text-right py-1.5 font-medium">Days to pay</th>
                                  <th className="text-right py-1.5 font-medium">Timing</th>
                                  <th className="text-left py-1.5 font-medium pl-4">Method</th>
                                  <th className="text-left py-1.5 font-medium">Window</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/50">
                                {(transactions ?? []).map((t: any) => {
                                  const timing = formatDaysLate(t.days_early_late);
                                  const ageDays = Math.floor(
                                    (Date.now() - new Date(t.payment_date + "T00:00:00Z").getTime()) / 86400000
                                  );
                                  const windowLabel =
                                    ageDays <= 30 ? "current" : ageDays <= 60 ? "prior" : "older";
                                  return (
                                    <tr key={t.id}>
                                      <td className="py-1.5 font-mono tabular-nums">{t.payment_date}</td>
                                      <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(t.amount_paid)}</td>
                                      <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                                        {t.days_to_pay ?? "—"}
                                      </td>
                                      <td className={cn("py-1.5 text-right font-mono tabular-nums", timing.className)}>
                                        {timing.text}
                                      </td>
                                      <td className="py-1.5 pl-4 text-muted-foreground">{t.payment_method ?? "—"}</td>
                                      <td className="py-1.5">
                                        <span
                                          className={cn(
                                            "text-[10px] px-1.5 py-0.5 rounded",
                                            windowLabel === "current"
                                              ? "bg-agent-payment/15 text-agent-payment"
                                              : windowLabel === "prior"
                                              ? "bg-secondary text-muted-foreground"
                                              : "text-muted-foreground/60"
                                          )}
                                        >
                                          {windowLabel}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
