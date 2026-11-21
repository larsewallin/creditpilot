import { useEffect, useMemo, useState } from "react";
import { plainSecText } from "@/lib/secSignalLabels";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AgentPill } from "@/components/AgentPill";
import { SeverityBadge } from "@/components/SeverityBadge";
import { DEMO_MODE } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { SkeletonCard } from "@/components/SkeletonCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Info, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { DemoDataNotice } from "@/components/DemoDataNotice";
import { eventLabel, summarize, type SignalLite } from "@/lib/eventLabels";

const SOURCES: [string, string][] = [
  ["all", "All sources"],
  ["ar_aging_agent", "AR aging"],
  ["payment_behaviour_agent", "Payments"],
  ["news_monitor_agent", "News"],
  ["sec_monitor_agent", "SEC filings"],
  ["credit_rating_agent", "Credit score"],
  ["industry_risk_agent", "Industry"],
  ["country_risk_agent", "Country"],
  ["fx_risk_agent", "FX"],
  ["risk_agent", "Risk (country, industry, FX exposure)"],
  ["cia-agent", "Assistant summaries"],
];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const PERIODS: [string, string][] = [["all", "Any time"], ["1", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"]];
const COMPOSITES = ["COMPOSITE_RISK_CRITICAL", "COMPOSITE_RISK_ELEVATED"];

function getEventDestination(evt: any): string | null {
  if (evt.event_type === "NEWS_EVENT" && evt.negative_news_id) {
    return `/news?event_id=${evt.negative_news_id}`;
  }
  if (evt.source_agent === "sec_monitor_agent") {
    return `/sec?customer_id=${evt.customer_id}`;
  }
  if (evt.source_agent === "payment_behaviour_agent" && evt.customer_id) {
    return `/payments?customer_id=${evt.customer_id}`;
  }
  // Industry events are scope='industry' with customer_id null — they route by
  // sector from the payload instead.
  if (evt.source_agent === "industry_risk_agent" && evt.payload?.sector) {
    return `/industry?sector=${encodeURIComponent(evt.payload.sector)}`;
  }
  // Country events are scope='country' with customer_id null — route by the
  // country code in the payload (tariffs carry origin_country instead).
  if (evt.source_agent === "country_risk_agent") {
    const code = evt.payload?.country_code ?? evt.payload?.origin_country;
    if (code) return `/country?country=${encodeURIComponent(code)}`;
  }
  if (evt.source_agent === "risk_agent") {
    const cc = evt.payload?.affected_countries?.[0];
    if (evt.event_type === "MACRO_TREND_WARNING" && cc) return `/country?country=${encodeURIComponent(cc)}`;
    if (evt.customer_id) return `/customers?customer_id=${evt.customer_id}`;
  }
  if (evt.source_agent === "fx_risk_agent" && evt.payload?.currency_code) {
    return `/fx?currency=${encodeURIComponent(evt.payload.currency_code)}`;
  }
  return null;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evt = any;

export default function CreditEvents() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const highlightedEventId = params.get("event_id");
  const filterCustomerId = params.get("customer_id");
  const view = params.get("view") === "summaries" ? "summaries" : "all";
  const source = params.get("source") ?? "all";
  const period = params.get("period") ?? "all";
  const sev = (params.get("severity") ?? "").split(",").filter((s) => (SEVERITIES as readonly string[]).includes(s));
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "" || v === "all") n.delete(k); else n.set(k, v); }
    n.delete("event_id");
    setParams(n, { replace: true });
  };
  useEffect(() => { const t = setTimeout(() => { if (search !== q) set({ q: search }); }, 300); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSev = (s: string) => set({ severity: (sev.includes(s) ? sev.filter((x) => x !== s) : [...sev, s]).join(",") });
  const anyFilter = view !== "all" || source !== "all" || period !== "all" || sev.length > 0 || !!q || !!filterCustomerId;

  const { data: pendingCount } = useQuery({
    queryKey: ["pending-actions-count"],
    queryFn: async () => {
      const { count } = await supabase.from("pending_actions").select("*", { count: "exact", head: true })
        .eq("status", "pending").eq("is_demo", DEMO_MODE)
        .neq("action_type", DEMO_MODE ? "NEW_CREDIT_LIMIT" : "__none__");
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  // Everything except severity, so the severity chips can show their counts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (query: any) => {
    query = query.eq("is_demo", DEMO_MODE).is("archived_at", null)
      // Briefings have no card; new-customer pipeline events live on each prospect's Activity tab.
      .neq("event_type", "DAILY_BRIEFING").neq("source_agent", "onboarding");
    if (view === "summaries") query = query.in("event_type", COMPOSITES);
    else if (source !== "all") query = query.eq("source_agent", source);
    if (period !== "all") query = query.gte("created_at", new Date(Date.now() - Number(period) * 86_400_000).toISOString());
    if (filterCustomerId) query = query.eq("customer_id", filterCustomerId);
    if (q) query = query.ilike("customers.company_name", `%${q}%`);
    return query;
  };
  const customersSelect = q ? "customers!inner(company_name)" : "customers(company_name)";

  const { data: events, isLoading } = useQuery({
    queryKey: ["credit-events-feed", view, source, period, sev.join(","), q, filterCustomerId],
    queryFn: async () => {
      let query = base(supabase.from("credit_events").select(`*, ${customersSelect}`));
      if (sev.length) query = query.in("severity", sev);
      const { data } = await query.order("created_at", { ascending: false }).limit(100);
      return (data ?? []) as Evt[];
    },
    refetchInterval: 30000,
  });

  const { data: sevCounts } = useQuery({
    queryKey: ["credit-events-sev-counts", view, source, period, q, filterCustomerId],
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(SEVERITIES.map(async (s) => {
        const { count } = await base(supabase.from("credit_events").select(`id, ${customersSelect}`, { count: "exact", head: true })).eq("severity", s);
        out[s] = count ?? 0;
      }));
      return out;
    },
    refetchInterval: 30000,
  });

  // The signals behind each summary card, and which customers have a proposed action.
  const summaryIds = useMemo(() => (events ?? []).filter((e) => COMPOSITES.includes(e.event_type))
    .flatMap((e) => (e.payload?.source_event_ids ?? []) as string[]), [events]);
  const { data: signals } = useQuery({
    queryKey: ["credit-events-summary-signals", summaryIds.join(",")],
    enabled: summaryIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("credit_events").select("id, event_type, severity, source_agent").in("id", summaryIds);
      return new Map(((data ?? []) as SignalLite[]).map((s) => [s.id, s]));
    },
  });
  const { data: actionCustomers } = useQuery({
    queryKey: ["credit-events-action-customers"],
    queryFn: async () => {
      const { data } = await supabase.from("pending_actions").select("customer_id").eq("status", "pending").eq("is_demo", DEMO_MODE);
      return new Set((data ?? []).map((r: { customer_id: string }) => r.customer_id));
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!highlightedEventId || isLoading) return;
    document.getElementById(`event-${highlightedEventId}`)?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [highlightedEventId, isLoading, events]);

  const hasActiveSession = sessionStorage.getItem("demo_activated") === "true";
  const showPendingBanner = DEMO_MODE ? hasActiveSession && (pendingCount ?? 0) > 0 : (pendingCount ?? 0) > 0;
  const customerName = filterCustomerId ? events?.[0]?.customers?.company_name ?? "one customer" : null;

  return (
    <div className="space-y-5 pb-48">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Credit Events</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Everything the monitoring agents found, newest first. Cards marked <span className="font-medium">Several warning signs</span> are
          the assistant's summary of a customer that more than one agent flags.{" "}
          <Link to="/about#severity" className="text-primary hover:underline inline-flex items-center gap-0.5"><Info className="h-3 w-3" />How severity works</Link>
        </p>
      </div>

      <DemoDataNotice message="Demo portfolio. Real company names are used for illustration only: every event, figure, score and news item below is fictional and says nothing about those companies." />

      {showPendingBanner && (
        <div className="flex items-center gap-3 bg-agent-aging/10 border border-agent-aging/30 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-agent-aging shrink-0" />
          <span className="text-sm text-foreground flex-1">
            <span className="font-semibold">{pendingCount}</span> proposed action{pendingCount !== 1 ? "s" : ""} waiting for approval
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs border-agent-aging/30 text-agent-aging hover:bg-agent-aging/10" onClick={() => navigate("/actions")}>
            Review actions →
          </Button>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="bg-card rounded-xl border p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="View">
            {([["all", "All events"], ["summaries", "Customer summaries"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => set({ view: v, source: null })} aria-pressed={view === v}
                className={cn("px-2.5 py-1 rounded", view === v ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
          <Select value={view === "summaries" ? "cia-agent" : source} onValueChange={(v) => set(v === "cia-agent" ? { view: "summaries", source: null } : { source: v, view: null })}>
            <SelectTrigger className="h-8 w-52 text-xs" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent>{SOURCES.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => set({ period: v })}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Period"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer…" aria-label="Search customer" className="h-8 w-48 text-xs" />
          {anyFilter && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => { setSearch(""); setParams(new URLSearchParams(), { replace: true }); }}>
              <X className="h-3.5 w-3.5" />Clear filters
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Severity">
          <span className="text-xs text-muted-foreground">Severity:</span>
          {SEVERITIES.map((s) => (
            <button key={s} type="button" onClick={() => toggleSev(s)} aria-pressed={sev.includes(s)}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors",
                sev.includes(s) ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {s} <span className="opacity-70">{sevCounts?.[s] ?? "…"}</span>
            </button>
          ))}
          {customerName && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs">
              Customer: {customerName}
              <button type="button" aria-label="Clear customer filter" onClick={() => set({ customer_id: null })}><X className="h-3 w-3" /></button>
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (events ?? []).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No events match these filters.</div>
        ) : (
          (events ?? []).map((evt) => COMPOSITES.includes(evt.event_type)
            ? <SummaryCard key={evt.id} evt={evt} highlighted={evt.id === highlightedEventId}
                signals={((evt.payload?.source_event_ids ?? []) as string[]).map((id) => signals?.get(id)).filter(Boolean) as SignalLite[]}
                hasAction={!!actionCustomers?.has(evt.customer_id)} />
            : <EventCard key={evt.id} evt={evt} highlighted={evt.id === highlightedEventId} onOpen={(d) => navigate(d)} />)
        )}
      </div>
    </div>
  );
}

function Subject({ evt }: { evt: Evt }) {
  if (evt.customers?.company_name) return <span className="font-semibold text-foreground">{evt.customers.company_name}</span>;
  const p = evt.payload ?? {};
  const label = p.sector ? `${p.sector} sector` : (p.country_code ?? p.origin_country) ? `${p.country_code ?? p.origin_country} country`
    : p.theme ? p.theme : p.currency_code ? `${p.currency_code} currency` : null;
  return label ? <span className="italic text-muted-foreground">{label}</span> : <span className="font-semibold text-foreground">Portfolio</span>;
}

function EventCard({ evt, highlighted, onOpen }: { evt: Evt; highlighted: boolean; onOpen: (dest: string) => void }) {
  const destination = getEventDestination(evt);
  return (
    <div id={`event-${evt.id}`} onClick={() => destination && onOpen(destination)}
      className={cn("bg-card rounded-xl border p-4", highlighted && "ring-2 ring-blue-500", destination && "cursor-pointer hover:bg-secondary/30 transition-colors")}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <SeverityBadge severity={evt.severity} />
            <span className="text-xs font-medium text-foreground">{eventLabel(evt.event_type)}</span>
            <AgentPill agentName={evt.source_agent} />
          </div>
          <p className="text-sm"><Subject evt={evt} /></p>
          {evt.title && <p className="text-sm text-foreground mt-0.5">{evt.title}</p>}
          {evt.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{plainSecText(evt.description)}</p>}
        </div>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 mt-1">{relativeTime(evt.created_at)}</span>
      </div>
    </div>
  );
}

function SummaryCard({ evt, signals, hasAction, highlighted }: { evt: Evt; signals: SignalLite[]; hasAction: boolean; highlighted: boolean }) {
  const company = evt.customers?.company_name ?? "this customer";
  const { headline, why } = summarize(company, signals, evt.severity);
  return (
    <div id={`event-${evt.id}`} className={cn("bg-card rounded-xl border border-l-4 p-4", evt.severity === "critical" ? "border-l-severity-critical" : "border-l-severity-high", highlighted && "ring-2 ring-blue-500")}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={evt.severity} />
            <span className="text-xs font-medium text-foreground">Several warning signs</span>
            <AgentPill agentName={evt.source_agent} />
          </div>
          <p className="text-sm font-medium text-foreground">{headline}</p>
          {why && <p className="text-xs text-muted-foreground">{why}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link to={`/events?customer_id=${evt.customer_id}`}>See the signals</Link>
            </Button>
            {hasAction && (
              <Button asChild size="sm" className="h-7 text-xs">
                <Link to={`/actions?customer_id=${evt.customer_id}`}>Review proposed action</Link>
              </Button>
            )}
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 mt-1">{relativeTime(evt.created_at)}</span>
      </div>
    </div>
  );
}
