import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ScenarioBadge } from "@/components/ScenarioBadge";
import { formatCurrency, relativeTime, scoreColor } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentPill } from "@/components/AgentPill";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function signalDotColor(severity: string) {
  if (severity === "critical" || severity === "high") return "bg-severity-critical";
  if (severity === "medium") return "bg-agent-aging";
  return "bg-muted-foreground";
}

function formatRatingSource(source: string): string {
  const labels: Record<string, string> = {
    sp: "S&P",
    dnb_paydex: "D&B Paydex",
    coface: "Coface",
  };
  return labels[source] ?? source;
}

// ── Customer Detail Drawer ────────────────────────────────────────────────────

export function CustomerDetail({ customer }: { customer: any }) {
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

  return (
    <div>
      <SheetHeader>
        <SheetTitle className="text-foreground">
          {customer.company_name}
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
              <p className="text-[10px] text-muted-foreground mt-0.5">{formatRatingSource(customer.credit_rating_source)}</p>
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
                    to={`/events?event_id=${s.id}`}
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

          {customer.notes && <p className="text-xs text-muted-foreground">{customer.notes}</p>}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Account Manager: <span className="text-foreground">{customer.account_manager}</span></p>
            <p>Payment Terms: <span className="text-foreground">{customer.payment_terms_days} days</span></p>
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <div className="space-y-2">
            {(invoices ?? []).map((inv: any) => {
              const dueDate = new Date(inv.due_date + "T00:00:00");
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const liveDaysOverdue = inv.status === "paid" || inv.status === "written_off"
                ? 0
                : Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / 86400000));
              const liveStatus = (inv.status === "current" || inv.status === "overdue")
                ? (liveDaysOverdue > 0 ? "overdue" : "current")
                : inv.status;
              const daysColor = liveDaysOverdue === 0 ? "text-risk-current" : liveDaysOverdue <= 30 ? "text-risk-low" : liveDaysOverdue <= 60 ? "text-severity-high" : liveDaysOverdue <= 90 ? "text-severity-critical" : "text-aging-over-90";
              return (
                <div key={inv.id} className="bg-secondary/30 rounded-lg p-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{inv.invoice_number}</span>
                    <Badge variant={liveStatus === "paid" ? "secondary" : liveStatus === "overdue" ? "destructive" : "outline"} className="text-[10px]">{liveStatus}</Badge>
                  </div>
                  <div className="flex justify-between mt-1.5 text-muted-foreground">
                    <span>Amount: {formatCurrency(inv.invoice_amount)} · Paid: {formatCurrency(inv.amount_paid)} · Out: {formatCurrency(inv.outstanding_amount)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Due: {inv.due_date}</span>
                    <span className={cn("font-medium", daysColor)}>{liveDaysOverdue > 0 ? `${liveDaysOverdue}d overdue` : "Current"}</span>
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
