import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_MODE } from "@/lib/constants";
import { SkeletonCard } from "@/components/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, ShieldAlert } from "lucide-react";

export default function SecFilings() {
  const { data: monitoring, isLoading } = useQuery({
    queryKey: ["sec-monitoring"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sec_monitoring")
        .select("*, customers!inner(company_name, ticker)")
        .eq("is_demo", true)
        .order("alert_triggered", { ascending: false });
      return data ?? [];
    },
  });

  const { data: secEvents } = useQuery({
    queryKey: ["sec-credit-events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("credit_events")
        .select("customer_id, event_type, description, severity")
        .eq("source_agent", "sec_monitor_agent")
        .eq("is_demo", true);
      return data ?? [];
    },
  });

  const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

  const eventsByCustomer = (secEvents ?? []).reduce<
    Record<string, { types: string[]; description: string | null; bestRank: number }>
  >((acc, e: any) => {
    if (!acc[e.customer_id]) acc[e.customer_id] = { types: [], description: null, bestRank: -1 };
    if (!acc[e.customer_id].types.includes(e.event_type)) acc[e.customer_id].types.push(e.event_type);
    const incomingRank = SEVERITY_RANK[e.severity] ?? 0;
    if (incomingRank > acc[e.customer_id].bestRank) {
      acc[e.customer_id].bestRank = incomingRank;
      acc[e.customer_id].description = e.description ?? null;
    }
    return acc;
  }, {});

  if (isLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;

  if (!monitoring || monitoring.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">SEC Filings</h1>
          <p className="text-xs text-muted-foreground mt-1">SEC filing data for monitored customers.</p>
        </div>
        <div className="flex items-center justify-center h-64 border border-dashed rounded-xl text-muted-foreground text-sm">
          No monitored customers found. Agents will populate this automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-48">
      <div>
        <h1 className="text-xl font-semibold text-foreground">SEC Filings</h1>
        <p className="text-xs text-muted-foreground mt-1">SEC filing data for monitored customers.</p>
      </div>

      <div className="space-y-4">
        {(monitoring ?? []).map((d: any) => {
          const customer = d.customers as { company_name: string; ticker: string | null };
          const customerEvents = eventsByCustomer[d.customer_id];
          const events = customerEvents?.types ?? [];
          const secUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${d.cik}&type=10-K&dateb=&owner=include&count=10`;
          return (
            <div key={d.id} className="bg-card rounded-xl border overflow-hidden">
              <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {customer.company_name}{" "}
                      <span className="text-muted-foreground font-normal">{customer.ticker}</span>
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">CIK: {d.cik}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {d.alert_triggered && (
                      <Badge variant="destructive" className="text-[10px] h-5">Alert Active</Badge>
                    )}
                    <a
                      href={secUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View SEC Filings <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {/* Last checked + alert date */}
                <div className="flex gap-6 mt-3 text-xs">
                  {d.last_checked_at && (
                    <div>
                      <span className="text-muted-foreground">Last checked:</span>{" "}
                      <span className="font-medium">{d.last_checked_at.slice(0, 10)}</span>
                    </div>
                  )}
                  {d.alert_date && (
                    <div>
                      <span className="text-muted-foreground">Alert date:</span>{" "}
                      <span className="font-medium">{d.alert_date}</span>
                    </div>
                  )}
                </div>

                {/* Top credit event description */}
                {customerEvents?.description && (
                  <div className="mt-3 flex items-start gap-1.5 bg-agent-sec/5 rounded-lg p-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-agent-sec mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      {customerEvents.description.slice(0, 150)}
                      {customerEvents.description.length > 150 ? "…" : ""}
                    </p>
                  </div>
                )}

                {/* Risk signals from credit_events */}
                {events.length > 0 && (
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {events.map((e) => (
                      <Badge key={e} variant="secondary" className="text-[10px]">
                        {e.replace(/_/g, " ")}
                      </Badge>
                    ))}
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
