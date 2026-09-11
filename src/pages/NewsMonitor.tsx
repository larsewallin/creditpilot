import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SeverityBadge } from "@/components/SeverityBadge";
import { relativeTime } from "@/lib/format";
import { SkeletonCard, SkeletonTable } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { DemoDataNotice } from "@/components/DemoDataNotice";

export default function NewsMonitor() {
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const highlightedEventId = searchParams.get("event_id");

  const { data: news, isLoading } = useQuery({
    queryKey: ["news-monitor"],
    queryFn: async () => {
      const { data } = await supabase
        .from("negative_news")
        .select("*, customers!inner(company_name)")
        .eq("is_demo", true)
        .order("news_date", { ascending: false });
      return data ?? [];
    },
  });

  const allNews = (news ?? []).filter((n) =>
    !search || n.headline.toLowerCase().includes(search.toLowerCase()) ||
    (n.customers as any)?.company_name?.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (!highlightedEventId || isLoading) return;
    document.getElementById(`news-${highlightedEventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedEventId, isLoading, news]);

  if (isLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonTable rows={8} /></div>;

  return (
    <div className="space-y-6 pb-48">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">News Monitor</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Full article archive. {news?.length ?? 0} articles — open one from a Credit Events source card for context, or browse below.
          </p>
        </div>
      </div>

      <DemoDataNotice message="These are fictional headlines generated for illustration, not real published articles. No external links exist because nothing was actually published." />

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
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allNews.map((n: any) => (
                <tr
                  key={n.id}
                  id={`news-${n.id}`}
                  className={cn(
                    "hover:bg-secondary/30 transition-colors",
                    n.id === highlightedEventId && "ring-2 ring-blue-500"
                  )}
                >
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{n.news_date}</td>
                  <td className="p-3 font-medium text-xs">{(n.customers as any).company_name}</td>
                  <td className="p-3 text-xs max-w-xs truncate">
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors">
                        {n.headline} <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      n.headline
                    )}
                  </td>
                  <td className="p-3"><Badge variant="secondary" className="text-[10px]">{n.category}</Badge></td>
                  <td className="p-3"><SeverityBadge severity={n.severity} /></td>
                  <td className="p-3 text-xs font-mono">{n.sentiment_score?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
