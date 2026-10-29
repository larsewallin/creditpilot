/**
 * One credit application, end to end: header with stage tracker and Reg B clock,
 * then tabs for the recommendation (memo + decision), the application, screening
 * (with the person-only dispositions), credit analysis (source tiles), activity and,
 * once approved, what monitoring will watch.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NewCustomerActionCard } from "@/components/NewCustomerActionCard";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { db, STAGES, STAGE_LABEL, SEVERITY_CLASS, callOnboarding, loadAppUsers, regBClock, viewOf, waitingOn, type ApplicationRow } from "@/lib/onboarding";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHECK_LABEL: Record<string, string> = {
  "registry:companies_house": "Companies House (UK registry)", "registry:sec_edgar": "SEC EDGAR (US public company)",
  "registry:gleif": "GLEIF (global LEI register)", "registry:state_registry": "State registry", "registry:national_registry": "National registry",
  "tax_id:vies": "EU VAT number (VIES)", "tax_id:hmrc_vat": "UK VAT number (HMRC)", "tax_id:ein_format": "US EIN format",
  domain_age: "Website domain age", sanctions_entity: "Company against OFAC, EU, UK and UN lists",
  sanctions_people: "Officers, directors and owners against OFAC, EU, UK and UN lists",
  fraud_flags_accepted: "Fraud flags accepted by a person",
};
const FLAG_LABEL: Record<string, string> = {
  YOUNG_ENTITY_LARGE_REQUEST: "Young company asking for a large limit", NEW_DOMAIN: "Website registered recently",
  ADDRESS_RISK: "Virtual, residential or PO-box address", FORMATION_DATE_MISMATCH: "Formation date differs from the registry",
  REGISTRY_NOT_FOUND: "Not found in the registry", REGISTRY_INACTIVE: "Registry shows dissolved or dormant", TAX_ID_INVALID: "Tax ID not valid",
};

export default function Prospect() {
  const { id = "" } = useParams();
  const { appUser } = useAuth();
  const qc = useQueryClient();
  const isCredit = !!appUser && ["admin", "credit_manager", "credit_analyst"].includes(appUser.role);
  const canDispose = !!appUser && ["admin", "credit_manager"].includes(appUser.role);

  const { data, isLoading, error } = useQuery({
    queryKey: ["prospect", id],
    queryFn: () => loadProspect(id),
    refetchInterval: 30_000,
  });
  const { data: users } = useQuery({ queryKey: ["app-users"], queryFn: loadAppUsers });

  const rerun = useMutation({
    mutationFn: () => callOnboarding({ action: "run", application_id: id }),
    onSuccess: () => { qc.invalidateQueries(); toast.success("Re-ran the checks"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const assign = useMutation({
    mutationFn: (patch: Record<string, string | null>) => callOnboarding({ action: "assign", application_id: id, ...patch }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  if (error || !data?.app) return <p className="text-sm text-destructive">{error ? (error as Error).message : "Application not found."}</p>;

  const { app, proposal, runs, checks, hits, scores, events, baseline } = data;
  const a = app.answers ?? {};
  const o = app.outcome ?? {};
  const row: ApplicationRow = { ...app, legal_name: a.legal_name, country: a.country_code, screening_status: o.screening?.status ?? null,
    decision: o.decision?.decision ?? null, approved_limit: o.decision?.approved_limit_usd ?? null, route: o.route ?? null, error: o.error ?? null,
    proposal: proposal ? { ...proposal, headline: proposal.memo?.headline ?? null } : undefined };
  const clock = regBClock(row);
  const stageIdx = STAGES.indexOf((app.stage === "approval" || app.stage === "conditions" ? "decision" : app.stage) as any);
  const view = viewOf(row);
  const approved = o.decision?.approved_limit_usd as number | undefined;
  const pendingProposal = proposal?.status === "pending" ? proposal : null;

  return (
    <div className="space-y-5 pb-48">
      <Link to="/new-customers" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />New customers
      </Link>

      <header className="bg-card rounded-xl border p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase">{view.replace("_", " ")}</Badge>
              {pendingProposal?.severity && <Badge className={cn("border-0 text-[10px]", SEVERITY_CLASS[pendingProposal.severity])}>{pendingProposal.severity}</Badge>}
              {clock && <span className={cn("text-xs", clock.days < 7 ? "text-destructive font-medium" : "text-muted-foreground")}>{clock.label}</span>}
            </div>
            <h1 className="text-xl font-semibold text-foreground">{a.legal_name} <span className="font-mono text-sm text-muted-foreground">{a.country_code}</span></h1>
            <p className="text-xs text-muted-foreground">
              {view === "approved" ? "Status: Active, monitored" : view === "closed" ? `Status: ${waitingOn(row)}` : `Waiting on: ${waitingOn(row)}`}
            </p>
            <div className="flex flex-wrap gap-4 pt-1">
              <Assignee label="Credit" value={app.credit_assignee} users={users ?? []} editable={isCredit}
                onChange={(v) => assign.mutate({ credit_assignee: v })} filter={(r) => r !== "sales" && r !== "viewer"} />
              <Assignee label="Sales" value={app.sales_assignee} users={users ?? []} editable={isCredit}
                onChange={(v) => assign.mutate({ sales_assignee: v })} filter={() => true} />
            </div>
          </div>
          <div className="flex gap-6 text-right">
            <Figure label="Requested" value={formatCurrency(app.requested_limit_usd)} />
            <Figure label={approved != null ? "Approved" : "Proposed"} value={approved != null ? formatCurrency(approved) : pendingProposal ? formatCurrency(pendingProposal.proposed_value) : "—"} />
            <Figure label="Terms" value={app.requested_terms_days ? `Net ${app.requested_terms_days}` : "—"} />
          </div>
        </div>
        <ol className="flex flex-wrap gap-1" aria-label="Stage">
          {STAGES.map((s, i) => (
            <li key={s} className={cn("flex-1 min-w-[90px] rounded-md px-2 py-1.5 text-[11px] text-center border",
              i < stageIdx ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                : i === stageIdx ? "bg-primary/10 text-primary border-primary/30 font-semibold" : "text-muted-foreground")}>
              {STAGE_LABEL[s]}
            </li>
          ))}
        </ol>
      </header>

      <Tabs defaultValue={view === "approved" ? "monitoring" : "recommendation"}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="recommendation">Recommendation</TabsTrigger>
          <TabsTrigger value="application">Application</TabsTrigger>
          <TabsTrigger value="screening">Screening{o.screening?.status && o.screening.status !== "pass" ? " •" : ""}</TabsTrigger>
          <TabsTrigger value="analysis">Credit analysis</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          {baseline && <TabsTrigger value="monitoring">Monitoring</TabsTrigger>}
        </TabsList>

        <TabsContent value="recommendation" className="space-y-3">
          {pendingProposal ? (
            <NewCustomerActionCard action={{ ...pendingProposal, customers: { company_name: a.legal_name } }} />
          ) : o.decision ? (
            <Panel title={o.decision.decision === "approved" ? `Approved at ${formatCurrency(o.decision.approved_limit_usd)}` : "Declined"}>
              <p className="text-xs text-muted-foreground">By {o.decision.by} on {format(new Date(o.decision.at), "MMM d, yyyy HH:mm")}{o.decision.note ? `: "${o.decision.note}"` : ""}</p>
              {proposal?.memo && <MemoView memo={proposal.memo} />}
            </Panel>
          ) : (
            <Panel title="No limit proposal yet">
              <p className="text-xs text-muted-foreground">
                {o.error ? `A check could not run: ${o.error}`
                  : app.status === "incomplete" ? `The application is missing: ${(o.completeness?.missing ?? []).join(", ").replace(/_/g, " ")}.`
                  : o.route === "existing_customer_limit_review" ? "This company is already a customer; it was routed to a limit review instead."
                  : o.screening?.status && o.screening.status !== "pass" ? "Screening needs a person first: see the Screening tab."
                  : "The agents are still working on this application."}
              </p>
              {isCredit && app.status !== "decided" && (
                <Button size="sm" variant="outline" className="h-7 text-xs mt-2" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
                  {rerun.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}Run the checks again
                </Button>
              )}
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="application"><ApplicationView a={a} /></TabsContent>

        <TabsContent value="screening">
          <ScreeningView app={app} runs={runs} checks={checks} hits={hits} canDispose={canDispose} />
        </TabsContent>

        <TabsContent value="analysis"><AnalysisView o={o} scores={scores} memo={proposal?.memo} a={a} /></TabsContent>

        <TabsContent value="activity">
          <Panel title="Activity">
            {events.length === 0 ? <p className="text-xs text-muted-foreground">No events yet.</p> : (
              <ol className="space-y-3">
                {events.map((e: any) => (
                  <li key={e.id} className="text-xs border-l-2 border-primary/30 pl-3">
                    <p className="font-medium text-foreground">{e.title}</p>
                    {e.summary && <p className="text-muted-foreground">{e.summary}</p>}
                    <p className="text-muted-foreground text-[10px]">{format(new Date(e.created_at), "MMM d, yyyy HH:mm")} · {e.event_type.replace(/_/g, " ").toLowerCase()}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </TabsContent>

        {baseline && (
          <TabsContent value="monitoring"><MonitoringView baseline={baseline} /></TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadProspect(id: string) {
  const { data: app, error } = await db.from("credit_applications").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) return { app: null } as any;
  const [{ data: props }, { data: runs }, { data: scores }, { data: events }, { data: baselines }] = await Promise.all([
    db.from("pending_actions").select("*").eq("application_id", id).eq("action_type", "NEW_CREDIT_LIMIT").order("created_at", { ascending: false }).limit(1),
    db.from("screening_runs").select("*").eq("application_id", id).order("started_at", { ascending: false }),
    db.from("score_results").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    db.from("credit_events").select("id, event_type, title, summary, created_at").eq("customer_id", app.customer_id).eq("payload->>application_id", id).order("created_at", { ascending: false }),
    db.from("underwriting_baseline").select("*").eq("application_id", id).order("approved_at", { ascending: false }).limit(1),
  ]);
  const runIds = (runs ?? []).map((r: any) => r.id);
  const [{ data: checks }, { data: hits }] = runIds.length
    ? await Promise.all([
      db.from("screening_checks").select("*").eq("run_id", runIds[0]).order("created_at"),
      db.from("screening_hits").select("*").in("run_id", runIds).order("created_at", { ascending: false }),
    ])
    : [{ data: [] }, { data: [] }];
  return { app, proposal: props?.[0] ?? null, runs: runs ?? [], checks: checks ?? [], hits: hits ?? [], scores: scores ?? [], events: events ?? [], baseline: baselines?.[0] ?? null };
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Figure({ label, value }: { label: string; value: string }) {
  return <div><div className="font-mono text-base font-semibold text-foreground">{value}</div><div className="text-[10px] text-muted-foreground">{label}</div></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="bg-card rounded-xl border p-4 space-y-2"><h2 className="text-sm font-semibold text-foreground">{title}</h2>{children}</section>;
}

function Assignee({ label, value, users, editable, onChange, filter }: {
  label: string; value: string | null; users: { user_id: string; display_name: string; role: string }[];
  editable: boolean; onChange: (v: string | null) => void; filter: (role: string) => boolean;
}) {
  const name = users.find((u) => u.user_id === value)?.display_name;
  return (
    <div className="text-xs">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label} assignee</div>
      {editable ? (
        <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
          <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {users.filter((u) => filter(u.role)).map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.display_name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : <span>{name ?? "Unassigned"}</span>}
    </div>
  );
}

function MemoView({ memo }: { memo: { headline: string; sections: { title: string; lines: string[]; sources: string[] }[] } }) {
  return (
    <div className="space-y-3 pt-2">
      {memo.sections.map((s) => (
        <div key={s.title} className="text-xs">
          <p className="font-semibold">{s.title}</p>
          <ul className="list-disc pl-4 space-y-0.5">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {s.sources.length > 0 && <p className="text-muted-foreground mt-1">Sources: {s.sources.join("; ")}</p>}
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[180px_1fr] gap-2 py-1 border-b border-border/50 last:border-0"><dt className="text-muted-foreground">{k}</dt><dd className="text-foreground">{v ?? "—"}</dd></div>;
}

function ApplicationView({ a }: { a: any }) {
  const r = a.credit_request ?? {};
  const addr = a.billing_address;
  return (
    <div className="grid gap-3 lg:grid-cols-2 text-xs">
      <Panel title="Company">
        <dl>
          <Row k="Legal name" v={a.legal_name} />
          <Row k="Trade name" v={a.trade_name} />
          <Row k="Entity type" v={a.entity_type} />
          <Row k="Country" v={a.country_code} />
          <Row k="Registration no." v={a.registration_no} />
          <Row k="Tax ID" v={a.tax_id} />
          <Row k="Website" v={a.website} />
          <Row k="Sector" v={a.sector} />
          <Row k="Established" v={a.date_established} />
          <Row k="Publicly listed" v={a.is_public ? `Yes${a.ticker ? ` (${a.ticker})` : ""}` : "No"} />
          <Row k="Billing address" v={addr ? `${addr.line1}, ${addr.city} ${addr.postal_code}, ${addr.country_code}` : null} />
          <Row k="Address type" v={a.address_type} />
        </dl>
      </Panel>
      <Panel title="Credit request">
        <dl>
          <Row k="Amount" v={formatCurrency(r.amount_usd)} />
          <Row k="Terms" v={r.terms_days ? `Net ${r.terms_days}` : null} />
          <Row k="Monthly purchases" v={r.monthly_purchases_usd != null ? formatCurrency(r.monthly_purchases_usd) : null} />
          <Row k="Invoicing currency" v={r.invoicing_currency} />
        </dl>
      </Panel>
      <Panel title="People">
        {(a.people ?? []).length ? <ul className="space-y-1">{a.people.map((p: any, i: number) => (
          <li key={i}>{p.name} <span className="text-muted-foreground">({p.role}{p.ownership_pct ? `, ${p.ownership_pct}%` : ""}{p.country_code ? `, ${p.country_code}` : ""})</span></li>
        ))}</ul> : <p className="text-muted-foreground">None listed on the application.</p>}
      </Panel>
      <Panel title="References and signatures">
        <dl>
          <Row k="Trade references" v={(a.trade_references ?? []).map((t: any) => t.company_name).join(", ") || "None"} />
          <Row k="Bank reference" v={a.bank_reference?.bank_name} />
          <Row k="Terms accepted" v={a.signatures?.terms ? "Yes" : "No"} />
          <Row k="Credit check consent" v={a.signatures?.credit_check_consent ? "Yes" : "No"} />
          <Row k="Personal guarantee" v={a.signatures?.personal_guarantee ? "Signed" : "No"} />
        </dl>
      </Panel>
      <Panel title="Financial statements">
        {(a.financial_statements ?? []).length ? (
          <table className="w-full">
            <thead><tr className="text-muted-foreground text-left"><th className="py-1">Period</th><th>Quality</th><th className="text-right">Current assets</th><th className="text-right">Current liabilities</th><th className="text-right">Equity</th></tr></thead>
            <tbody>{a.financial_statements.map((s: any, i: number) => (
              <tr key={i}><td className="py-1">{s.period_end}</td><td>{s.statement_quality}</td>
                <td className="text-right font-mono">{formatCurrency(s.current_assets)}</td><td className="text-right font-mono">{formatCurrency(s.current_liabilities)}</td><td className="text-right font-mono">{formatCurrency(s.equity)}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="text-muted-foreground">None uploaded.</p>}
      </Panel>
      {a.bureau_report && (
        <Panel title="Uploaded bureau report">
          <dl>
            <Row k="Bureau" v={a.bureau_report.bureau} />
            <Row k="Score (0–100)" v={a.bureau_report.score_normalized} />
            <Row k="Max credit recommendation" v={a.bureau_report.max_credit_recommendation_usd != null ? formatCurrency(a.bureau_report.max_credit_recommendation_usd) : null} />
          </dl>
        </Panel>
      )}
    </div>
  );
}

function ResultPill({ result }: { result: string }) {
  const cls = result === "pass" ? "bg-emerald-500/15 text-emerald-700" : result === "fail" ? "bg-destructive/15 text-destructive"
    : result === "skipped" ? "bg-secondary text-muted-foreground" : "bg-amber-500/15 text-amber-700";
  return <Badge className={cn("border-0 text-[10px]", cls)}>{result}</Badge>;
}

function ScreeningView({ app, runs, checks, hits, canDispose }: { app: any; runs: any[]; checks: any[]; hits: any[]; canDispose: boolean }) {
  const qc = useQueryClient();
  const [acting, setActing] = useState<{ kind: "cleared" | "confirmed" | "flags"; hitId?: string } | null>(null);
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: () => acting?.kind === "flags"
      ? callOnboarding({ action: "accept_fraud_flags", application_id: app.id, note })
      : callOnboarding({ action: "dispose_hit", hit_id: acting?.hitId, disposition: acting?.kind, note }),
    onSuccess: () => { qc.invalidateQueries(); setActing(null); setNote(""); toast.success("Recorded. The checks ran again."); },
    onError: (e) => toast.error((e as Error).message),
  });
  const s = app.outcome?.screening;
  if (!runs.length) return <Panel title="Screening"><p className="text-xs text-muted-foreground">Screening has not run yet{app.status === "incomplete" ? ": the application is incomplete" : ""}.</p></Panel>;
  const flagsAccepted = !!app.outcome?.cleared?.fraud_flags_accepted;
  const flags: string[] = s?.fraud_flags ?? [];

  const NoteBox = (
    <div className="space-y-2 pt-2">
      <Textarea placeholder="Your reasoning (required, at least 10 characters). It is kept in the audit trail." value={note}
        onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[60px]" />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={() => act.mutate()} disabled={act.isPending || note.trim().length < 10}>
          {act.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}Confirm
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setActing(null); setNote(""); }}>Cancel</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 text-xs">
      <Panel title={`Screening: ${s?.status ?? runs[0].result}`}>
        <p className="text-muted-foreground">The company and {s?.people_screened ?? 0} {s?.people_screened === 1 ? "person" : "people"} screened on {format(new Date(runs[0].started_at), "MMM d, yyyy HH:mm")}. Lists refresh daily; screening refuses to run on lists older than 3 days.</p>
      </Panel>

      <Panel title="Business and legal verification">
        <ul className="divide-y divide-border">
          {checks.filter((c) => !c.check_type.startsWith("fraud_flag:")).map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 gap-3">
              <span>{CHECK_LABEL[c.check_type] ?? (c.check_type.startsWith("registry_unavailable") ? `Registry could not be checked (${c.check_type.split(":")[1]?.replace(/_/g, " ") ?? "unavailable"})` : c.check_type)}</span>
              <ResultPill result={c.result} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Sanctions matches">
        {hits.length === 0 ? <p className="text-muted-foreground">No names came close to any list entry.</p> : (
          <ul className="space-y-3">
            {hits.map((h) => (
              <li key={h.id} className="rounded-lg border p-3 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{h.subject_name} <span className="text-muted-foreground">~</span> {h.matched_name}</span>
                  <Badge className={cn("border-0 text-[10px]", h.disposition === "open" ? "bg-amber-500/15 text-amber-700" : h.disposition === "cleared" ? "bg-emerald-500/15 text-emerald-700" : "bg-destructive/15 text-destructive")}>{h.disposition}</Badge>
                </div>
                <p className="text-muted-foreground">
                  {h.list_name} list · similarity {Number(h.similarity).toFixed(2)}
                  {h.detail?.list_country ? ` · listed country ${h.detail.list_country}` : ""}{h.detail?.list_dob ? ` · born ${h.detail.list_dob}` : ""}
                  {h.detail?.country_match === true ? " · country matches" : h.detail?.country_match === false ? " · country differs" : ""}
                  {h.detail?.dob_match === true ? " · birth year matches" : ""}
                </p>
                {h.disposition_note && <p className="text-muted-foreground">Decision note: "{h.disposition_note}"</p>}
                {h.disposition === "open" && (canDispose ? (
                  acting?.hitId === h.id ? NoteBox : (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActing({ kind: "cleared", hitId: h.id })}><Check className="h-3 w-3 mr-1" />Clear: not the same party</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => setActing({ kind: "confirmed", hitId: h.id })}><X className="h-3 w-3 mr-1" />Confirm match</Button>
                    </div>
                  )
                ) : <p className="text-muted-foreground">A credit manager must clear or confirm this match.</p>)}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Fraud flags">
        {flags.length === 0 ? <p className="text-muted-foreground">None.</p> : (
          <>
            <ul className="list-disc pl-4">{flags.map((f) => <li key={f}>{FLAG_LABEL[f] ?? f}</li>)}</ul>
            {flagsAccepted ? <p className="text-emerald-700">Accepted by a person after checking.</p>
              : s?.status === "review" && canDispose ? (acting?.kind === "flags" ? NoteBox : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActing({ kind: "flags" })}>Accept flags after checking</Button>
              )) : s?.status === "review" ? <p className="text-muted-foreground">A credit manager must review these flags.</p> : null}
          </>
        )}
      </Panel>
    </div>
  );
}

const SOURCE_TILES: { key: string; name: string; note: string }[] = [
  { key: "file", name: "File scoring app", note: "Your scoring model" },
  { key: "bureau_report", name: "Uploaded bureau report", note: "Any bureau the applicant or you already use" },
  { key: "sec_edgar", name: "SEC EDGAR", note: "Audited financials for US public companies" },
  { key: "uploaded_statements", name: "Uploaded statements", note: "Financials sent with the application" },
];
const CONNECT_TILES = ["Dun & Bradstreet", "Creditsafe", "Experian"];

function AnalysisView({ o, scores, memo, a }: { o: any; scores: any[]; memo?: any; a: any }) {
  const an = o.analysis;
  if (!an) return <Panel title="Credit analysis"><p className="text-xs text-muted-foreground">Analysis runs after screening passes.</p></Panel>;
  const tile = (key: string) => {
    if (key === "file" || key === "bureau_report") {
      const s = scores.find((x) => x.provider === key && x.status === "ok");
      if (s) return { state: "used", text: `Score ${s.score}${s.band ? ` (band ${s.band})` : ""}` };
      const f = an.fallbacks?.find((x: any) => x.provider === key);
      if (f) return { state: "gap", text: f.reason.replace(/_/g, " ") };
      if (key === "bureau_report" && a.bureau_report) return { state: "available", text: `${a.bureau_report.bureau} report on file` };
      return { state: "idle", text: "Not used" };
    }
    if (an.financials_source === key) return { state: "used", text: `Used (${an.statement_quality ?? "statements"})` };
    const f = an.fallbacks?.find((x: any) => x.provider === key);
    return f ? { state: "gap", text: f.reason.replace(/_/g, " ") } : { state: "idle", text: "Not used" };
  };
  const working = memo?.sections?.find((s: any) => s.title === "Limit working");
  return (
    <div className="space-y-3 text-xs">
      <Panel title="Credit data sources">
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          {SOURCE_TILES.map((t) => {
            const st = tile(t.key);
            return (
              <div key={t.key} className={cn("rounded-lg border p-3 space-y-1", st.state === "used" ? "border-primary/40 bg-primary/5" : "")}>
                <p className="font-semibold">{t.name}</p>
                <p className="text-muted-foreground">{t.note}</p>
                <p className={cn(st.state === "used" ? "text-primary font-medium" : st.state === "gap" ? "text-amber-700" : "text-muted-foreground")}>{st.text}</p>
              </div>
            );
          })}
          {CONNECT_TILES.map((n) => (
            <div key={n} className="rounded-lg border border-dashed p-3 space-y-1 opacity-60">
              <p className="font-semibold">{n}</p>
              <p className="text-muted-foreground">Bring your own licence</p>
              <p className="text-muted-foreground">Connect in Settings</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Score">
        <p>{an.score != null ? `${an.score} (band ${an.band}) from ${an.score_source === "file" ? "the File scoring app" : "the uploaded bureau report"}` : "No score could be obtained."}</p>
      </Panel>
      <Panel title="Market context">
        {an.macro_context?.length ? <ul className="space-y-1">{an.macro_context.map((m: any, i: number) => (
          <li key={i}><Badge className={cn("border-0 text-[10px] mr-1.5", SEVERITY_CLASS[m.severity === "low" ? "info" : m.severity] ?? "")}>{m.severity}</Badge>{m.title} <span className="text-muted-foreground">({m.key})</span></li>
        ))}</ul> : <p className="text-muted-foreground">No current country, currency or industry signals for this applicant.</p>}
      </Panel>
      {working && (
        <Panel title="Limit working">
          <ul className="list-disc pl-4 space-y-0.5">{working.lines.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
        </Panel>
      )}
    </div>
  );
}

function MonitoringView({ baseline }: { baseline: any }) {
  const b = baseline.assumptions ?? {};
  return (
    <div className="space-y-3 text-xs">
      <Panel title="What monitoring will watch">
        <p className="text-muted-foreground">The approval rested on these facts. The monitoring agents now cover this customer, and a change against any of them is worth a fresh look.</p>
        <dl className="pt-2">
          <Row k="Approved limit" v={formatCurrency(b.approved_limit_usd)} />
          <Row k="Terms" v={b.payment_terms_days ? `Net ${b.payment_terms_days}` : null} />
          <Row k="Score at approval" v={b.score != null ? `${b.score} (band ${b.band}, ${b.score_source})` : null} />
          <Row k="Financials" v={b.financials_source ? `${String(b.financials_source).replace(/_/g, " ")}${b.statement_quality ? ` (${b.statement_quality})` : ""}` : null} />
          <Row k="Limit bound by" v={b.binding_method ? String(b.binding_method).replace(/_/g, " ") : null} />
          <Row k="Country / currency" v={`${b.country_code ?? "—"} / ${b.invoicing_currency ?? "—"}`} />
          <Row k="Screening at approval" v={b.screening_at_approval ? `${b.screening_at_approval.status}, the entity and ${b.screening_at_approval.people_screened} ${b.screening_at_approval.people_screened === 1 ? "person" : "people"}` : null} />
        </dl>
      </Panel>
      <Panel title="Market signals at approval">
        {b.macro_context_at_approval?.length ? <ul className="space-y-1">{b.macro_context_at_approval.map((m: any, i: number) => (
          <li key={i}>{m.severity}: {m.title} <span className="text-muted-foreground">({m.key})</span></li>
        ))}</ul> : <p className="text-muted-foreground">None.</p>}
      </Panel>
      <p className="text-muted-foreground">Approved {format(new Date(baseline.approved_at), "MMM d, yyyy")}.</p>
    </div>
  );
}
