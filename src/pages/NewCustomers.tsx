/**
 * New customers: every credit application in one sortable table, with saved
 * views (Needs decision, In progress, Waiting on applicant, Approved, Declined & closed).
 */
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SkeletonTable } from "@/components/SkeletonCard";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  VIEWS, STAGE_LABEL, SEVERITY_CLASS, type ViewKey, type ApplicationRow,
  loadApplications, loadAppUsers, viewOf, waitingOn, regBClock, initials,
} from "@/lib/onboarding";

type SortKey = "company" | "requested" | "due" | "updated";

export default function NewCustomers() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as ViewKey) || "needs_decision";
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updated", dir: -1 });

  const { data: apps, isLoading, error } = useQuery({ queryKey: ["onboarding-apps"], queryFn: loadApplications, refetchInterval: 30_000 });
  const { data: users } = useQuery({ queryKey: ["app-users"], queryFn: loadAppUsers });
  const userName = (id: string | null) => users?.find((u) => u.user_id === id)?.display_name ?? null;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps?.length ?? 0 };
    for (const a of apps ?? []) c[viewOf(a)] = (c[viewOf(a)] ?? 0) + 1;
    return c;
  }, [apps]);

  const rows = useMemo(() => {
    const list = (apps ?? []).filter((a) => (view === "all" || viewOf(a) === view) &&
      (!search || (a.legal_name ?? "").toLowerCase().includes(search.toLowerCase())));
    const val = (a: ApplicationRow): string | number => {
      switch (sort.key) {
        case "company": return (a.legal_name ?? "").toLowerCase();
        case "requested": return a.requested_limit_usd ?? 0;
        case "due": return regBClock(a)?.days ?? 9999;
        default: return a.updated_at;
      }
    };
    return [...list].sort((x, y) => (val(x) > val(y) ? 1 : val(x) < val(y) ? -1 : 0) * sort.dir);
  }, [apps, view, search, sort]);

  const canSubmit = appUser && ["admin", "credit_manager", "credit_analyst"].includes(appUser.role);
  const th = (key: SortKey, label: string, right = false) => (
    <th className={cn("p-3 font-medium cursor-pointer select-none", right ? "text-right" : "text-left")}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "company" ? 1 : -1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="space-y-5 pb-48">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">New customers</h1>
          <p className="text-xs text-muted-foreground">Every applicant, from credit application to monitored customer.</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search company…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 h-8 text-xs" />
          {canSubmit && (
            <Button size="sm" className="h-8 text-xs" onClick={() => navigate("/new-customers/new")}>
              <Plus className="h-3.5 w-3.5 mr-1" />New application
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Saved views">
        {VIEWS.map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key}
            onClick={() => setParams({ view: v.key })}
            className={cn("px-3 h-8 rounded-full text-xs border transition-colors",
              view === v.key ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:text-foreground")}>
            {v.label} <span className="opacity-70 font-mono">{counts[v.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-destructive">Could not load applications: {(error as Error).message}</p>
      ) : isLoading ? <SkeletonTable rows={8} /> : rows.length === 0 ? (
        <div className="flex items-center justify-center h-24 border border-dashed rounded-xl text-muted-foreground text-sm">
          Nothing here.
        </div>
      ) : (
        <div className="bg-card rounded-xl border overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead className="bg-secondary/50">
              <tr className="text-muted-foreground">
                {th("company", "Company")}
                <th className="text-left p-3 font-medium">Stage</th>
                <th className="text-left p-3 font-medium">Waiting on</th>
                {th("requested", "Requested", true)}
                <th className="text-right p-3 font-medium">Proposed / approved</th>
                <th className="text-left p-3 font-medium">Terms</th>
                <th className="text-left p-3 font-medium">Severity</th>
                <th className="text-left p-3 font-medium">Credit</th>
                <th className="text-left p-3 font-medium">Sales</th>
                {th("due", "Reg B clock")}
                {th("updated", "Updated")}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => {
                const clock = regBClock(a);
                const amount = a.approved_limit ? Number(a.approved_limit) : a.proposal?.status === "pending" ? a.proposal.proposed_value : null;
                return (
                  <tr key={a.id} className="hover:bg-secondary/30 cursor-pointer" onClick={() => navigate(`/new-customers/${a.id}`)}>
                    <td className="p-3">
                      <Link to={`/new-customers/${a.id}`} className="font-medium text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
                        {a.legal_name ?? "Unnamed"}
                      </Link>
                      <span className="ml-1.5 font-mono text-muted-foreground">{a.country}</span>
                    </td>
                    <td className="p-3">{STAGE_LABEL[a.stage] ?? a.stage}</td>
                    <td className="p-3 text-muted-foreground">{waitingOn(a)}</td>
                    <td className="p-3 text-right font-mono">{formatCurrency(a.requested_limit_usd)}</td>
                    <td className="p-3 text-right font-mono">{amount != null ? formatCurrency(amount) : "—"}</td>
                    <td className="p-3">{a.requested_terms_days ? `Net ${a.requested_terms_days}` : "—"}</td>
                    <td className="p-3">
                      {a.proposal?.status === "pending" && a.proposal.severity
                        ? <Badge className={cn("border-0 text-[10px]", SEVERITY_CLASS[a.proposal.severity])}>{a.proposal.severity}</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3"><Person name={userName(a.credit_assignee)} /></td>
                    <td className="p-3"><Person name={userName(a.sales_assignee)} /></td>
                    <td className={cn("p-3 whitespace-nowrap", clock && clock.days < 7 ? "text-destructive font-medium" : "text-muted-foreground")}>
                      {clock?.label ?? "—"}
                    </td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{format(new Date(a.updated_at), "MMM d")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Person({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted-foreground">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[9px] font-semibold inline-flex items-center justify-center">{initials(name)}</span>
      {name}
    </span>
  );
}
