import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AgentPill } from "@/components/AgentPill";
import { SeverityBadge } from "@/components/SeverityBadge";
import { DEMO_MODE } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { SkeletonCard } from "@/components/SkeletonCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";

const AGENT_TABS = [
  { value: "all", label: "All" },
  { value: "ar_aging_agent", label: "AR Aging" },
  { value: "news_monitor_agent", label: "News" },
  { value: "sec_monitor_agent", label: "SEC" },
];

export default function CreditEvents() {
  const [agentFilter, setAgentFilter] = useState("all");
  const navigate = useNavigate();

  const { data: pendingCount } = useQuery({
    queryKey: ["pending-actions-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("pending_actions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("is_demo", true);
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  const { data: events, isLoading } = useQuery({
    queryKey: ["credit-events-feed", agentFilter],
    queryFn: async () => {
      let query = supabase
        .from("credit_events")
        .select("*, customers(company_name, ticker)")
        .eq("is_demo", true)
        .order("created_at", { ascending: false })
        .limit(100);

      if (agentFilter !== "all") {
        query = query.eq("source_agent", agentFilter);
      }

      const { data } = await query;
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  const hasActiveSession = sessionStorage.getItem("demo_activated") === "true";
  const showPendingBanner = DEMO_MODE
    ? hasActiveSession && (pendingCount ?? 0) > 0
    : (pendingCount ?? 0) > 0;

  return (
    <div className="space-y-6 pb-48">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Credit Events</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Unified signal log from all monitoring agents.
        </p>
      </div>

      {showPendingBanner && (
        <div className="flex items-center gap-3 bg-agent-aging/10 border border-agent-aging/30 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-agent-aging shrink-0" />
          <span className="text-sm text-foreground flex-1">
            <span className="font-semibold">{pendingCount}</span> agent action{pendingCount !== 1 ? "s" : ""} require your approval
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-agent-aging/30 text-agent-aging hover:bg-agent-aging/10"
            onClick={() => navigate("/actions")}
          >
            Review Pending Actions →
          </Button>
        </div>
      )}

      <Tabs value={agentFilter} onValueChange={setAgentFilter}>
        <TabsList className="h-8">
          {AGENT_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs h-7">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (events ?? []).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No credit events found</div>
        ) : (
          (events ?? []).map((evt: any) => (
            <div key={evt.id} className="bg-card rounded-xl border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <SeverityBadge severity={evt.severity} />
                    <AgentPill agentName={evt.source_agent} />
                    <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                      {evt.event_type}
                    </span>
                  </div>
                  <p className="text-sm">
                    <span className="font-semibold text-foreground">{evt.customers?.company_name ?? "—"}</span>
                    {evt.customers?.ticker && (
                      <span className="text-muted-foreground ml-1.5 text-xs">{evt.customers.ticker}</span>
                    )}
                  </p>
                  {evt.title && (
                    <p className="text-sm font-medium text-foreground mt-0.5">{evt.title}</p>
                  )}
                  {evt.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{evt.description}</p>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                  {relativeTime(evt.created_at)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
