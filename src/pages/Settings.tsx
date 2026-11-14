/**
 * Company settings the credit team changes without code: which credit score counts
 * (Keen by default, or D&B, Creditsafe, Coface, Allianz Trade, Experian, another
 * provider), how old accounts may be at each score, and when each agent runs. Admins and credit managers
 * save; everyone else sees them.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { getSettings, saveSetting, previewScheduler, type AgentSchedule, type SchedulerPreview } from "@/lib/onboarding";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FREQUENCIES: [number, string][] = [[1, "Every hour"], [2, "Every 2 hours"], [3, "Every 3 hours"], [4, "Every 4 hours"], [6, "Every 6 hours"],
  [8, "Every 8 hours"], [12, "Every 12 hours"], [24, "Daily"], [168, "Weekly (Mondays)"]];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

const AGE_FIELDS: [string, string][] = [
  ["max_age_months_70_plus", "Score 70 or more"],
  ["max_age_months_55_to_69", "Score 55–69"],
  ["max_age_months_40_to_54", "Score 40–54"],
  ["max_age_months_below_40", "Score under 40"],
  ["max_age_months_no_score", "No score"],
  ["due_soon_months", "Show \"due soon\" this many months before"],
];

export default function Settings() {
  const { appUser } = useAuth();
  const canEdit = !!appUser && ["admin", "credit_manager"].includes(appUser.role);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const [order, setOrder] = useState<string[]>([]);
  const [age, setAge] = useState<Record<string, string>>({});
  const [sched, setSched] = useState<Record<string, AgentSchedule>>({});
  const [tz, setTz] = useState("UTC");
  const [preview, setPreview] = useState<SchedulerPreview | null>(null);
  const runPreview = useMutation({ mutationFn: previewScheduler, onSuccess: setPreview, onError: (e) => toast.error((e as Error).message) });

  useEffect(() => {
    if (!q.data) return;
    setOrder(q.data.settings.sources.score_order.filter((id) => id !== "bureau_report"));
    setAge(Object.fromEntries(Object.entries(q.data.settings.financials ?? {}).map(([k, v]) => [k, String(v)])));
    const a = q.data.settings.agents ?? {};
    setTz(typeof a.timezone === "string" ? a.timezone : "UTC");
    setSched(Object.fromEntries(Object.entries(a).filter(([k]) => k !== "timezone")) as Record<string, AgentSchedule>);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      await saveSetting("onboarding.sources", { score_order: [...order, "bureau_report"] });
      await saveSetting("onboarding.financials", Object.fromEntries(Object.entries(age).map(([k, v]) => [k, Number(v)])));
      await saveSetting("agents.schedule", { timezone: tz.trim() || "UTC", ...sched });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Saved. New applications use these settings."); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading settings…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Settings are unavailable"}</p>;

  const providers = q.data.score_providers;
  const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const scale = (id: string) => providers.find((p) => p.id === id)?.scale ?? "";
  const unused = providers.filter((p) => !order.includes(p.id));
  const move = (i: number, d: number) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });

  return (
    <div className="space-y-5 max-w-3xl pb-24">
      <h1 className="text-xl font-semibold text-foreground">Settings</h1>

      <section className="bg-card rounded-xl border p-4 space-y-3 text-xs">
        <h2 className="text-sm font-semibold">Credit score source</h2>
        <p className="text-muted-foreground">The first source in this list that has a score for a company counts; scores are never averaged. Keen is the default. If you use Dun &amp; Bradstreet, Creditsafe, Coface, Allianz Trade, Experian or another provider, move it to the top. Its score is typed from the provider's report on the application and put on the same 0–100 scale (higher is safer).</p>
        <ol className="divide-y divide-border rounded-lg border">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-5 text-muted-foreground">{i + 1}.</span>
              <span className="flex-1"><span className="font-medium">{name(id)}</span> <span className="text-muted-foreground">· {scale(id)}</span></span>
              {canEdit && <>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label={`Move ${name(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label={`Move ${name(id)} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" disabled={order.length === 1} onClick={() => setOrder((o) => o.filter((x) => x !== id))}>Don't use</Button>
              </>}
            </li>
          ))}
        </ol>
        {unused.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Not used:</p>
            <div className="flex flex-wrap gap-2">
              {unused.map((p) => canEdit
                ? <Button key={p.id} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOrder((o) => [...o, p.id])}>Use {p.name}</Button>
                : <span key={p.id} className="text-muted-foreground">{p.name}</span>)}
            </div>
          </div>
        )}
      </section>

      <section className="bg-card rounded-xl border p-4 space-y-3 text-xs">
        <h2 className="text-sm font-semibold">How old accounts may be</h2>
        <p className="text-muted-foreground">Months from the financial year end after which newer accounts are needed. Lower scores need fresher accounts.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {AGE_FIELDS.map(([k, label]) => (
            <label key={k} className="block space-y-1"><span className="text-muted-foreground">{label}</span>
              <Input value={age[k] ?? ""} disabled={!canEdit} inputMode="numeric" onChange={(e) => setAge((a) => ({ ...a, [k]: e.target.value.replace(/[^0-9]/g, "") }))} className="h-8 text-xs w-28" /></label>
          ))}
        </div>
      </section>

      <section className="bg-card rounded-xl border p-4 space-y-3 text-xs">
        <h2 className="text-sm font-semibold">Agent schedules</h2>
        {q.data.demo
          ? <p className="rounded-md bg-amber-500/10 text-amber-800 px-2 py-1">This is the demo: its agents run only when you press Reset Demo, so the sample scores, events and actions stay as they are. These schedules apply when CreditPilot runs on your own data.</p>
          : <p className="text-muted-foreground">CreditPilot checks every 15 minutes which agents are due. The Risk agent and CIA's decisioning follow the others: they run once new results are in.</p>}
        <label className="block space-y-1 max-w-xs"><span className="text-muted-foreground">Time zone (e.g. America/New_York, Europe/London)</span>
          <Input value={tz} disabled={!canEdit} onChange={(e) => setTz(e.target.value)} className="h-8 text-xs" /></label>
        <table className="w-full">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Agent</th><th>On</th><th>How often</th><th>From</th></tr></thead>
          <tbody>
            {q.data.agents.map((a) => {
              const s = sched[a.key] ?? { enabled: true, every_hours: 24, at_hour: 0 };
              const set = (v: Partial<AgentSchedule>) => setSched((x) => ({ ...x, [a.key]: { ...s, ...v } }));
              return (
                <tr key={a.key} className="border-t">
                  <td className="py-1.5 pr-2">{a.label}</td>
                  <td><input type="checkbox" aria-label={`${a.label} on`} checked={s.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} /></td>
                  {a.stage === "sense" ? <>
                    <td className="pr-2">
                      <Select value={String(s.every_hours)} disabled={!canEdit || !s.enabled} onValueChange={(v) => set({ every_hours: Number(v) })}>
                        <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{FREQUENCIES.map(([h, l]) => <SelectItem key={h} value={String(h)}>{l}</SelectItem>)}</SelectContent>
                      </Select></td>
                    <td>
                      <Select value={String(s.at_hour)} disabled={!canEdit || !s.enabled} onValueChange={(v) => set({ at_hour: Number(v) })}>
                        <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>{Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{hh(h)}</SelectItem>)}</SelectContent>
                      </Select></td>
                  </> : <td colSpan={2} className="text-muted-foreground">After the agents above</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {canEdit && (
          <div className="space-y-2">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => runPreview.mutate()} disabled={runPreview.isPending}>
              {runPreview.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}What would run now?</Button>
            {preview && (
              <div className="rounded-md border p-2 space-y-1">
                <p className="text-muted-foreground">{preview.mode === "demo" ? "Demo: nothing is started. On your own data, at " : "At "}{new Date(preview.now).toLocaleString()} ({preview.timezone}) the saved schedules would start:</p>
                {preview.due.length ? <ul className="list-disc pl-4">{preview.due.map((d) => <li key={d.key}>{d.label} <span className="text-muted-foreground">({d.reason})</span></li>)}</ul> : <p>Nothing: every agent has run since its last scheduled time.</p>}
              </div>
            )}
          </div>
        )}
      </section>

      {canEdit
        ? <Button onClick={() => save.mutate()} disabled={save.isPending || order.length === 0}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save settings</Button>
        : <p className="text-xs text-muted-foreground">Admins and credit managers can change these settings.</p>}
    </div>
  );
}
