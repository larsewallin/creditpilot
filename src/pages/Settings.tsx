/**
 * Company settings the credit team changes without code: which credit score counts
 * (Keen by default, or D&B, Creditsafe, Coface, Allianz Trade, Experian, another
 * provider), and how old accounts may be at each score. Admins and credit managers
 * save; everyone else sees them.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { getSettings, saveSetting } from "@/lib/onboarding";

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

  useEffect(() => {
    if (!q.data) return;
    setOrder(q.data.settings.sources.score_order.filter((id) => id !== "bureau_report"));
    setAge(Object.fromEntries(Object.entries(q.data.settings.financials ?? {}).map(([k, v]) => [k, String(v)])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      await saveSetting("onboarding.sources", { score_order: [...order, "bureau_report"] });
      await saveSetting("onboarding.financials", Object.fromEntries(Object.entries(age).map(([k, v]) => [k, Number(v)])));
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

      {canEdit
        ? <Button onClick={() => save.mutate()} disabled={save.isPending || order.length === 0}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save settings</Button>
        : <p className="text-xs text-muted-foreground">Admins and credit managers can change these settings.</p>}
    </div>
  );
}
