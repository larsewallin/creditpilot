import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ScenarioBadge } from "@/components/ScenarioBadge";
import { formatCurrency } from "@/lib/format";
import { SkeletonTable } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentPill } from "@/components/AgentPill";
import { relativeTime } from "@/lib/format";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DEMO_MODE } from "@/lib/constants";

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number | null) {
  if (score == null) return "";
  if (score >= 80) return "text-risk-current";
  if (score >= 60) return "text-agent-aging";
  if (score >= 40) return "text-severity-high";
  return "text-severity-critical";
}

function signalDotColor(severity: string) {
  if (severity === "critical" || severity === "high") return "bg-severity-critical";
  if (severity === "medium") return "bg-agent-aging";
  return "bg-muted-foreground";
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Customers() {
  const [search, setSearch] = useState("");
  const [scenarioFilter, setScenarioFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("*")
        .order("company_name");
      return data ?? [];
    },
  });

  const selectedCustomer = customers?.find((c) => c.id === selectedId);

  const filtered = (customers ?? []).filter((c: any) => {
    if (search && !c.company_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (scenarioFilter !== "all" && c.scenario !== scenarioFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 pb-48">
      <h1 className="text-xl font-semibold text-foreground">Customers</h1>

      <div className="flex gap-3">
        <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 h-8 text-xs" />
        <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
          <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="All risk categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk categories</SelectItem>
            <SelectItem value="normal_operations">Normal</SelectItem>
            <SelectItem value="payment_issues">Payment Issues</SelectItem>
            <SelectItem value="credit_deterioration">Credit Deterioration</SelectItem>
            <SelectItem value="negative_news">Negative News</SelectItem>
            <SelectItem value="bankruptcy">Bankruptcy</SelectItem>
            <SelectItem value="growth_opportunity">Growth</SelectItem>
            <SelectItem value="sec_filing_monitoring">SEC Monitoring</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <SkeletonTable rows={15} /> : (
        <div className="bg-card rounded-xl border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50 sticky top-0">
              <tr className="text-muted-foreground">
                <th className="text-left p-3 font-medium">Company</th>
                <th className="text-left p-3 font-medium">Risk Category</th>
                <th className="text-right p-3 font-medium">Credit Limit</th>
                <th className="text-right p-3 font-medium">Exposure</th>
                <th className="text-right p-3 font-medium">Util%</th>
                <th className="text-right p-3 font-medium">Credit Score</th>
                <th className="text-left p-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c: any) => {
                const util = c.credit_limit > 0 ? (c.current_exposure / c.credit_limit) * 100 : 0;
                const score = c.credit_rating_score as number | null;
                return (
                  <tr key={c.id} className="hover:bg-secondary/30 cursor-pointer" onClick={() => setSelectedId(c.id)}>
                    <td className="p-3">
                      <span className="font-medium">{c.company_name}</span>
                      <span className="text-muted-foreground ml-1.5">{c.ticker}</span>
                    </td>
                    <td className="p-3"><ScenarioBadge scenario={c.scenario} /></td>
                    <td className="p-3 text-right">{formatCurrency(c.credit_limit)}</td>
                    <td className="p-3 text-right">{formatCurrency(c.current_exposure)}</td>
                    <td className="p-3 text-right">{util.toFixed(1)}%</td>
                    <td className={cn("p-3 text-right font-medium", scoreColor(score))}>
                      {score != null ? score : <span className="text-muted-foreground font-normal">NR</span>}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 flex-wrap max-w-[200px]">
                        {(c.flags ?? []).slice(0, 3).map((f: string) => (
                          <Badge key={f} variant="secondary" className="text-[9px]">{f.replace(/_/g, " ")}</Badge>
                        ))}
                        {(c.flags?.length ?? 0) > 3 && <Badge variant="secondary" className="text-[9px]">+{c.flags.length - 3}</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Customer Detail Drawer */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selectedCustomer && <CustomerDetail customer={selectedCustomer} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Customer Detail Drawer ────────────────────────────────────────────────────

function CustomerDetail({ customer }: { customer: any }) {
  const { data: invoices } = useQuery({
    queryKey: ["customer-invoices", customer.id],
    queryFn: async () => {
      const { data } = await supabase.from("invoices").select("*").eq("customer_id", customer.id).order("due_date");
      return data ?? [];
    },
  });

  const { data: payments } = useQuery({
    queryKey: ["customer-payments", customer.id],
    queryFn: async () => {
      const { data } = await supabase.from("payment_transactions").select("*").eq("customer_id", customer.id).order("payment_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: recentSignals } = useQuery({
    queryKey: ["customer-signals", customer.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("credit_events")
        .select("id, event_type, source_agent, severity, created_at")
        .eq("customer_id", customer.id)
        .eq("is_demo", true)
        .order("created_at", { ascending: false })
        .limit(3);
      return data ?? [];
    },
  });

  const { data: activity } = useQuery({
    queryKey: ["customer-activity", customer.id],
    queryFn: async () => {
      const [news, events, actions] = await Promise.all([
        supabase.from("negative_news").select("*").eq("customer_id", customer.id).eq("is_demo", true).order("created_at", { ascending: false }),
        supabase.from("credit_events").select("*").eq("customer_id", customer.id).eq("is_demo", true).order("created_at", { ascending: false }),
        supabase.from("credit_actions").select("*").eq("customer_id", customer.id).order("created_at", { ascending: false }),
      ]);
      const items = [
        ...(news.data ?? []).map((n) => ({ ...n, _type: "news" as const })),
        ...(events.data ?? []).map((e) => ({ ...e, _type: "event" as const })),
        ...(actions.data ?? []).map((a) => ({ ...a, _type: "action" as const })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);
      return items;
    },
  });

  const util = customer.credit_limit > 0 ? (customer.current_exposure / customer.credit_limit) * 100 : 0;
  const score = customer.credit_rating_score as number | null;
  const riskTags: string[] = customer.risk_tags ?? [];
  const manualFlags: string[] = customer.flags ?? [];

  return (
    <div>
      <SheetHeader>
        <SheetTitle className="text-foreground">
          {customer.company_name}{" "}
          <span className="text-muted-foreground font-normal">{customer.ticker}</span>
        </SheetTitle>
      </SheetHeader>
      <div className="mt-2 mb-4"><ScenarioBadge scenario={customer.scenario} /></div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full h-8">
          <TabsTrigger value="overview" className="text-xs flex-1">Overview</TabsTrigger>
          <TabsTrigger value="invoices" className="text-xs flex-1">Invoices</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs flex-1">Payments</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs flex-1">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Credit Score */}
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground uppercase">Credit Score</p>
            <p className={cn("text-2xl font-bold", score == null ? "text-muted-foreground" : scoreColor(score))}>
              {score != null ? score : "No Rating"}
            </p>
            {score != null && customer.credit_rating_source ? (
              <p className="text-[10px] text-muted-foreground mt-0.5">{customer.credit_rating_source}</p>
            ) : score == null ? (
              <p className="text-[10px] text-muted-foreground mt-0.5">Provider: N/A</p>
            ) : null}
          </div>

          {/* Utilization Bar */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Credit Utilization</span>
              <span className="font-medium">{formatCurrency(customer.current_exposure)} / {formatCurrency(customer.credit_limit)}</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", util > 90 ? "bg-severity-critical" : util > 70 ? "bg-agent-aging" : "bg-risk-current")}
                style={{ width: `${Math.min(util, 100)}%` }}
              />
            </div>
          </div>

          {/* Agent Tags */}
          {riskTags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Agent Signals</p>
                {customer.risk_tags_updated_at && (
                  <p className="text-[10px] text-muted-foreground">Updated {relativeTime(customer.risk_tags_updated_at)}</p>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {riskTags.map((tag: string) => (
                  <span key={tag} className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-agent-aging text-white">
                    {tag.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent Signals */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Recent Signals</p>
              <Link
                to={`/events?customer_id=${customer.id}`}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                View all →
              </Link>
            </div>
            {(recentSignals ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No recent signals</p>
            ) : (
              <div className="space-y-1">
                {(recentSignals ?? []).map((s: any) => (
                  <Link
                    key={s.id}
                    to={`/events?customer_id=${customer.id}`}
                    className="flex items-center gap-2 text-xs hover:bg-secondary/50 rounded px-1 py-0.5 transition-colors"
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", signalDotColor(s.severity))} />
                    <span className="font-medium">{s.event_type.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">·</span>
                    <AgentPill agentName={s.source_agent} />
                    <span className="text-muted-foreground ml-auto">{s.created_at.slice(0, 10)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Manual Tags */}
          {manualFlags.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Manual Tags</p>
              <div className="flex gap-1.5 flex-wrap">
                {manualFlags.map((f: string) => (
                  <Badge key={f} variant="outline" className="text-[10px]">{f.replace(/_/g, " ")}</Badge>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Set by credit manager</p>
            </div>
          )}

          {customer.notes && <p className="text-xs text-muted-foreground">{customer.notes}</p>}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Account Manager: <span className="text-foreground">{customer.account_manager}</span></p>
            <p>Payment Terms: <span className="text-foreground">{customer.payment_terms_days} days</span></p>
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <div className="space-y-2">
            {(invoices ?? []).map((inv: any) => {
              const daysColor = inv.days_overdue === 0 ? "text-risk-current" : inv.days_overdue <= 30 ? "text-risk-low" : inv.days_overdue <= 60 ? "text-severity-high" : inv.days_overdue <= 90 ? "text-severity-critical" : "text-aging-over-90";
              return (
                <div key={inv.id} className="bg-secondary/30 rounded-lg p-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{inv.invoice_number}</span>
                    <Badge variant={inv.status === "paid" ? "secondary" : inv.status === "overdue" ? "destructive" : "outline"} className="text-[10px]">{inv.status}</Badge>
                  </div>
                  <div className="flex justify-between mt-1.5 text-muted-foreground">
                    <span>Amount: {formatCurrency(inv.invoice_amount)} · Paid: {formatCurrency(inv.paid_amount)} · Out: {formatCurrency(inv.outstanding_amount)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Due: {inv.due_date}</span>
                    <span className={cn("font-medium", daysColor)}>{inv.days_overdue > 0 ? `${inv.days_overdue}d overdue` : "Current"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <div className="space-y-2">
            {(payments ?? []).map((p: any) => (
              <div key={p.id} className="bg-secondary/30 rounded-lg p-3 text-xs flex justify-between">
                <div>
                  <p className="font-medium">{p.payment_date} · {formatCurrency(p.amount_paid)}</p>
                  <p className="text-muted-foreground">{p.payment_method} · Net {p.days_to_pay}</p>
                </div>
                <span className={cn("font-medium", (p.days_early_late ?? 0) >= 0 ? "text-risk-current" : "text-severity-critical")}>
                  {(p.days_early_late ?? 0) >= 0 ? `${p.days_early_late ?? 0}d early` : `${Math.abs(p.days_early_late)}d late`}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <div className="space-y-2">
            {(activity ?? []).map((item: any) => (
              <div key={item.id} className="bg-secondary/30 rounded-lg p-3 text-xs border-l-2 border-l-agent-news">
                <div className="flex items-center gap-2 mb-1">
                  <AgentPill agentName={item.agent_name} />
                  <span className="text-muted-foreground">{relativeTime(item.created_at)}</span>
                </div>
                <p className="font-medium capitalize">{item._type === "news" ? item.headline : item._type === "event" ? item.event_type?.replace(/_/g, " ") : item.action_type?.replace(/_/g, " ")}</p>
                <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.description ?? item.summary}</p>
              </div>
            ))}
          </div>
          {(activity ?? []).length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-3 text-center">Showing last 10 activities</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
