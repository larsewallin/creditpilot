import { useQuery } from "@tanstack/react-query";
import { DEMO_MODE } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import { AgentPill } from "@/components/AgentPill";
import { SeverityBadge } from "@/components/SeverityBadge";
import { relativeTime } from "@/lib/format";
import { SkeletonCard, SkeletonTable } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export default function NewsMonitor() {
  const [search, setSearch] = useState("");

  const { data: news, isLoading } = useQuery({
    queryKey: ["news-monitor"],
    queryFn: async () => {
      const { data } = await supabase
        .from("negative_news")
        .select("*, customers!inner(company_name, ticker)")
        .eq("is_demo", true)
        .order("news_date", { ascending: false });
      return data ?? [];
    },
  });

  const unreviewed = (news ?? []).filter((n) => !n.reviewed);
  const allNews = (news ?? []).filter((n) =>
    !search || n.headline.toLowerCase().includes(search.toLowerCase()) ||
    (n.customers as any)?.company_name?.toLowerCase().includes(search.toLowerCase())
  );

  const hasActiveSession = sessionStorage.getItem("demo_activated") === "true";

  if (DEMO_MODE && !hasActiveSession) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">News Monitor</h1>
          <p className="text-xs text-muted-foreground mt-1">Negative news alerts for monitored customers.</p>
        </div>
        <div className="flex items-center justify-center h-64 border border-dashed rounded-xl text-muted-foreground text-sm">
          No news alerts found. Agents will populate this automatically.
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonTable rows={8} /></div>;

  return (
    <div className="space-y-6 pb-48">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">News Monitor</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {news?.length ?? 0} articles · <span className="text-agent-aging font-medium">{unreviewed.length} unreviewed</span>
          </p>
        </div>
      </div>

      {/* Review Queue */}
      {unreviewed.length > 0 && (
        <div className="bg-agent-aging/5 border border-agent-aging/20 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-agent-aging mb-3">Needs Review ({unreviewed.length})</h2>
          <div className="space-y-3">
            {unreviewed.map((n: any) => (
              <div key={n.id} className="bg-card rounded-lg border p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <SeverityBadge severity={n.severity} />
                      <span className="text-xs text-muted-foreground">{n.source}</span>
                      {n.sentiment_score != null && n.sentiment_score < -0.5 && (
                        <span className="text-[10px] text-severity-critical font-mono">{n.sentiment_score.toFixed(2)}</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-foreground">{(n.customers as any).company_name}
                      <span className="text-muted-foreground font-normal ml-1.5 text-xs">{(n.customers as any).ticker}</span>
                    </p>
                    <p className="text-sm font-medium text-foreground mt-0.5">{n.headline}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{n.summary}</p>
                    {n.category && <Badge variant="secondary" className="mt-2 text-[10px]">{n.category}</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Articles Table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">All Articles</h2>
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-48 h-8 text-xs" />
        </div>
        <div className="bg-card rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr className="text-xs text-muted-foreground">
                <th className="text-left p-3 font-medium">Date</th>
                <th className="text-left p-3 font-medium">Customer</th>
                <th className="text-left p-3 font-medium">Headline</th>
                <th className="text-left p-3 font-medium">Category</th>
                <th className="text-left p-3 font-medium">Severity</th>
                <th className="text-left p-3 font-medium">Sentiment</th>
                <th className="text-left p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allNews.map((n: any) => (
                <tr key={n.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{n.news_date}</td>
                  <td className="p-3 font-medium text-xs">{(n.customers as any).company_name}</td>
                  <td className="p-3 text-xs max-w-xs truncate">{n.headline}</td>
                  <td className="p-3"><Badge variant="secondary" className="text-[10px]">{n.category}</Badge></td>
                  <td className="p-3"><SeverityBadge severity={n.severity} /></td>
                  <td className="p-3 text-xs font-mono">{n.sentiment_score?.toFixed(2)}</td>
                  <td className="p-3">
                    {n.reviewed
                      ? <span className="text-risk-current text-xs">Reviewed</span>
                      : <span className="text-muted-foreground text-xs">Pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
