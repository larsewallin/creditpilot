import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AgentPill } from "@/components/AgentPill";
import { getAgentConfig, DEMO_MODE } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { SkeletonCard } from "@/components/SkeletonCard";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FeedItem = {
  id: string;
  type: "news" | "sec" | "action";
  agent_name: string | null;
  company_name: string;
  ticker: string | null;
  title: string;
  detail: string | null;
  created_at: string;
  reviewed?: boolean;
  severity?: string | null;
  action_status?: string | null;
};

// Strip raw field-label lines (e.g. "Company: X", "CIK: X") and truncate to 120 chars
function cleanDetail(text: string | null | undefined): string | null {
  if (!text) return null;
  const fieldLabel = /^[A-Z][A-Za-z\s\-]+:\s/;
  const first = text
    .split(/\n+/)
    .map((l) => l.trim())
    .find((l) => l.length > 10 && !fieldLabel.test(l));
  const result = (first ?? text.split(/\n/)[0].trim()).replace(/\s+/g, " ");
  return result.length > 120 ? result.slice(0, 117) + "…" : result || null;
}

const DATE_FILTERS = ["all", "today", "7days", "30days"] as const;

export default function ActivityFeed() {
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
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
  });

  const hasActiveSession = sessionStorage.getItem("demo_activated") === "true";
  const showPendingBanner = DEMO_MODE
    ? hasActiveSession && (pendingCount ?? 0) > 0
    : (pendingCount ?? 0) > 0;

  const { data: feedItems, isLoading: feedLoading } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: async () => {
      const [newsRes, secRes, msgsRes, pendingRes] = await Promise.all([
        supabase.from("negative_news").select("*, customers!inner(company_name, ticker)").eq("is_demo", true).order("created_at", { ascending: false }).limit(100),
        supabase.from("sec_filings").select("*, customers!inner(company_name, ticker)").eq("is_demo", true).order("created_at", { ascending: false }).limit(50),
        supabase.from("agent_messages").select("*, customers(company_name, ticker)").eq("is_demo", true).order("created_at", { ascending: false }).limit(100),
        supabase.from("pending_actions").select("*, customers(company_name, ticker)").eq("is_demo", true).order("created_at", { ascending: false }).limit(100),
      ]);
      const items: FeedItem[] = [];
      (newsRes.data ?? []).forEach((n: any) => items.push({
        id: `news-${n.id}`, type: "news", agent_name: n.agent_name,
        company_name: n.customers.company_name, ticker: n.customers.ticker,
        title: n.headline, detail: cleanDetail(n.summary),
        created_at: n.created_at, reviewed: n.reviewed, severity: n.severity,
      }));
      (secRes.data ?? []).forEach((s: any) => items.push({
        id: `sec-${s.id}`, type: "sec", agent_name: s.agent_name,
        company_name: s.customers.company_name, ticker: s.customers.ticker,
        title: `${s.filing_type} Filing`, detail: cleanDetail(s.key_findings),
        created_at: s.created_at, reviewed: s.reviewed, severity: null,
      }));
      (msgsRes.data ?? []).forEach((m: any) => items.push({
        id: `msg-${m.id}`,
        type: m.template_type === "news_alert" ? "news" : m.template_type === "sec_alert" ? "sec" : "action",
        agent_name: m.agent_name,
        company_name: m.customers?.company_name ?? m.recipient_name,
        ticker: m.customers?.ticker ?? null,
        title: m.subject,
        detail: cleanDetail(m.body),
        created_at: m.created_at,
        reviewed: false,
        severity: null,
      }));
      (pendingRes.data ?? []).forEach((p: any) => items.push({
        id: `pending-${p.id}`, type: "action", agent_name: p.agent_name,
        company_name: p.customers?.company_name ?? "—", ticker: p.customers?.ticker ?? null,
        title: p.action_type?.replace(/_/g, " ") ?? "Action",
        detail: cleanDetail(p.rationale),
        created_at: p.created_at, severity: null, action_status: p.status,
      }));
      return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  });

  const filtered = (feedItems ?? []).filter((item) => {
    if (agentFilter !== "all" && item.agent_name !== agentFilter) return false;
    if (unreviewedOnly && item.reviewed !== false) return false;
    if (dateFilter !== "all") {
      const d = new Date(item.created_at);
      const now = new Date();
      if (dateFilter === "today" && d.toDateString() !== now.toDateString()) return false;
      if (dateFilter === "7days" && now.getTime() - d.getTime() > 7 * 86400000) return false;
      if (dateFilter === "30days" && now.getTime() - d.getTime() > 30 * 86400000) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Activity Feed</h1>

      {/* Pending Actions Banner */}
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

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <Tabs value={agentFilter} onValueChange={setAgentFilter}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs h-7">All</TabsTrigger>
            <TabsTrigger value="news_monitor_agent" className="text-xs h-7">News</TabsTrigger>
            <TabsTrigger value="ar_aging_agent" className="text-xs h-7">AR Aging</TabsTrigger>
            <TabsTrigger value="sec_monitor_agent" className="text-xs h-7">SEC</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Switch checked={unreviewedOnly} onCheckedChange={setUnreviewedOnly} id="unreviewed" />
          <label htmlFor="unreviewed" className="text-xs text-muted-foreground cursor-pointer">Unreviewed only</label>
        </div>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7days">Last 7 days</SelectItem>
            <SelectItem value="30days">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Feed */}
      <div className="space-y-2">
        {feedLoading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No activity found</div>
        ) : (
          filtered.slice(0, 50).map((item) => {
            const config = getAgentConfig(item.agent_name);
            return (
              <div key={item.id} className={cn("bg-card rounded-xl border border-l-4 p-4", config.borderClass)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <AgentPill agentName={item.agent_name} />
                      {item.reviewed === false && item.type !== "action" && (
                        <Badge variant="outline" className="bg-agent-aging/10 text-agent-aging border-agent-aging/30 text-[10px] h-5">Needs Review</Badge>
                      )}
                      {item.severity === "critical" && (
                        <Badge variant="destructive" className="text-[10px] h-5">Critical</Badge>
                      )}
                      {item.action_status === "pending" && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-400/30 text-[10px] h-5">Pending</Badge>
                      )}
                      {item.action_status === "approved" && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-400/30 text-[10px] h-5">Approved</Badge>
                      )}
                      {item.action_status === "rejected" && (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px] h-5">Rejected</Badge>
                      )}
                    </div>
                    <p className="text-sm">
                      <span className="font-semibold text-foreground">{item.company_name}</span>
                      {item.ticker && <span className="text-muted-foreground ml-1.5 text-xs">{item.ticker}</span>}
                    </p>
                    <p className="text-sm font-medium text-foreground mt-0.5 capitalize">{item.title}</p>
                    {item.detail && (
                      <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{relativeTime(item.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
