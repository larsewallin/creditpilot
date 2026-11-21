/**
 * Settings › Credit policy: the company's own Trade Credit Policy. Every rule the agents and
 * onboarding use, grouped by section; customer groups that override only the rules they need;
 * a preview of what a change would change before it is saved. Read-only in the demo and for
 * users who are not admins or credit managers.
 */
import { SCORE_BANDS } from "@/lib/scoreLabel";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { db, saveSetting, type SettingsAnswer } from "@/lib/onboarding";
import { assignGroup, previewPolicy, resetSetting, type PolicyChange, type PolicyGroup } from "@/lib/policy";
import { POLICY_SECTIONS, fieldInfo, flatten, fromShown, policyMarkdown, toShown, unflatten, type PolicySectionInfo } from "@/lib/policyFields";

// The scale from the engine's own file, so this page can never disagree with the agents.
const SCALE = SCORE_BANDS.map((b, i) => [i === 0 ? `${b.min}–100` : `${b.min}–${SCORE_BANDS[i - 1].min - 1}`, b.label]);

/** The section's current value from the settings answer. */
function sectionValue(data: SettingsAnswer, key: string): unknown {
  const [ns, s] = key.split(".");
  const st = data.settings as Record<string, unknown>;
  return ns === "policy" ? (st.policy as Record<string, unknown> | undefined)?.[s] : st[s];
}

function Section({ info, data, canEdit }: { info: PolicySectionInfo; data: SettingsAnswer; canEdit: boolean }) {
  const qc = useQueryClient();
  const current = useMemo(() => flatten(sectionValue(data, info.key)), [data, info.key]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [changes, setChanges] = useState<PolicyChange[] | null>(null);
  useEffect(() => {
    setVals(Object.fromEntries(current.map(([p, v]) => [p, toShown(v, fieldInfo(info.key, p).kind)])));
    setChanges(null);
  }, [current, info.key]);

  const edited = current.some(([p, v]) => vals[p] !== undefined && vals[p] !== toShown(v, fieldInfo(info.key, p).kind));
  const customised = info.key in (data.overrides ?? {});
  const value = () => unflatten(current.map(([p]) => [p, fromShown(vals[p] ?? "", fieldInfo(info.key, p).kind)]));
  const done = () => { qc.invalidateQueries({ queryKey: ["settings"] }); setChanges(null); };

  const save = useMutation({ mutationFn: () => saveSetting(info.key, value()), onSuccess: () => { done(); toast.success(`${info.title}: saved. The agents use it from their next run.`); }, onError: (e) => toast.error((e as Error).message) });
  const reset = useMutation({ mutationFn: () => resetSetting(info.key), onSuccess: () => { done(); toast.success(`${info.title}: back to CreditPilot's defaults.`); }, onError: (e) => toast.error((e as Error).message) });
  const preview = useMutation({ mutationFn: () => previewPolicy(info.key, value()), onSuccess: (r) => setChanges(r.changes), onError: (e) => toast.error((e as Error).message) });

  return (
    <section className="bg-card rounded-xl border p-4 space-y-3 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{info.title}</h3>
        <span className="text-muted-foreground">{customised ? "Your company's values" : "CreditPilot's defaults"}</span>
      </div>
      <p className="text-muted-foreground">{info.blurb}</p>
      <table className="w-full">
        <tbody>
          {current.map(([p]) => {
            const f = fieldInfo(info.key, p);
            return (
              <tr key={p} className="border-t border-border">
                <td className="py-1.5 pr-3">{f.label}</td>
                <td className="py-1.5 w-28">
                  <Input aria-label={f.label} value={vals[p] ?? ""} disabled={!canEdit} inputMode="decimal"
                    onChange={(e) => setVals((v) => ({ ...v, [p]: e.target.value.replace(/[^0-9.]/g, "") }))} className="h-7 text-xs" />
                </td>
                <td className="py-1.5 pl-2 text-muted-foreground whitespace-nowrap">{f.unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {info.preview && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!edited || preview.isPending} onClick={() => preview.mutate()}>
            {preview.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Preview changes</Button>}
          <Button size="sm" className="h-7 text-xs" disabled={!edited || save.isPending} onClick={() => save.mutate()}>Save</Button>
          {customised && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={reset.isPending} onClick={() => reset.mutate()}>Back to defaults</Button>}
        </div>
      )}
      {!info.preview && canEdit && edited && <p className="text-muted-foreground">These rules need a fresh agent run, so they cannot be previewed: they apply from the agents' next run.</p>}
      {changes && <ChangeList changes={changes} />}
    </section>
  );
}

function ChangeList({ changes }: { changes: PolicyChange[] }) {
  if (!changes.length) return <p className="rounded-md bg-muted px-3 py-2">No customer's payment health, limit-use alert or overdue alert would change.</p>;
  return (
    <div className="rounded-md border">
      <p className="px-3 py-2 font-medium">{changes.length} change{changes.length === 1 ? "" : "s"} if saved</p>
      <table className="w-full">
        <thead><tr className="text-muted-foreground text-left border-t"><th className="px-3 py-1 font-normal">Customer</th><th className="font-normal">Rule</th><th className="font-normal">Now</th><th className="font-normal">After</th></tr></thead>
        <tbody>{changes.map((c, i) => (
          <tr key={i} className="border-t"><td className="px-3 py-1">{c.company_name}</td><td>{c.rule}</td><td>{c.before}</td><td className="font-medium">{c.after}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Every policy rule a group can override, as "policy.<section>:<field>". */
const OVERRIDABLE = POLICY_SECTIONS.filter((s) => s.key.startsWith("policy.") && s.key !== "policy.fx" && s.key !== "policy.approvals");

function Groups({ data, canEdit }: { data: SettingsAnswer; canEdit: boolean }) {
  const qc = useQueryClient();
  const stored = ((data.settings as Record<string, unknown>).policy_groups ?? {}) as Record<string, PolicyGroup>;
  const [groups, setGroups] = useState<Record<string, PolicyGroup>>(stored);
  useEffect(() => setGroups(stored), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const customers = useQuery({
    queryKey: ["policy-group-customers"],
    queryFn: async () => {
      const { data: rows, error } = await db.from("customers").select("id, company_name, policy_group").order("company_name");
      if (error) throw new Error(error.message);
      return rows as { id: string; company_name: string; policy_group: string | null }[];
    },
  });
  const [pick, setPick] = useState<Record<string, { rule?: string; value?: string; customer?: string }>>({});

  const save = useMutation({ mutationFn: () => saveSetting("policy.groups", groups), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Customer groups saved."); }, onError: (e) => toast.error((e as Error).message) });
  const assign = useMutation({
    mutationFn: ({ id, group }: { id: string; group: string | null }) => assignGroup(id, group),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["policy-group-customers"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const ruleLabel = (rule: string) => {
    const [section, field] = rule.split(":");
    return `${POLICY_SECTIONS.find((s) => s.key === section)?.title}: ${fieldInfo(section, field).label}`;
  };
  const setGroup = (k: string, g: PolicyGroup) => setGroups((all) => ({ ...all, [k]: g }));
  const dirty = JSON.stringify(groups) !== JSON.stringify(stored);

  return (
    <section className="bg-card rounded-xl border p-4 space-y-3 text-xs">
      <h3 className="text-sm font-semibold">Customer groups</h3>
      <p className="text-muted-foreground">A group changes only the rules listed for it; everything else follows the company policy above. A customer is in one group at most. Payment terms and limits stay on each customer.</p>
      {Object.entries(groups).map(([k, g]) => {
        const rules = Object.entries(g.overrides ?? {}).flatMap(([s, v]) => flatten(v).map(([f, n]) => [`policy.${s}:${f}`, n] as [string, number]));
        const members = (customers.data ?? []).filter((c) => c.policy_group === k);
        const others = (customers.data ?? []).filter((c) => c.policy_group !== k);
        const pk = pick[k] ?? {};
        return (
          <div key={k} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input aria-label="Group name" value={g.name} disabled={!canEdit} onChange={(e) => setGroup(k, { ...g, name: e.target.value })} className="h-7 text-xs font-semibold w-48" />
              <Input aria-label="What the group is for" value={g.note} disabled={!canEdit} onChange={(e) => setGroup(k, { ...g, note: e.target.value })} className="h-7 text-xs flex-1" />
              {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove group ${g.name}`} disabled={members.length > 0}
                title={members.length ? "Move its customers out first" : undefined}
                onClick={() => setGroups((all) => Object.fromEntries(Object.entries(all).filter(([x]) => x !== k)))}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
            <ul className="space-y-1">
              {rules.map(([rule, n]) => {
                const [section, field] = rule.split(":");
                const f = fieldInfo(section, field);
                return (
                  <li key={rule} className="flex items-center gap-2">
                    <span className="flex-1">{ruleLabel(rule)}: <span className="font-medium">{toShown(n, f.kind)} {f.unit}</span></span>
                    {canEdit && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => {
                      const s = section.slice("policy.".length);
                      const sec = { ...(g.overrides[s] ?? {}) };
                      delete sec[field];
                      const ov = { ...g.overrides, [s]: sec };
                      if (!Object.keys(sec).length) delete ov[s];
                      setGroup(k, { ...g, overrides: ov });
                    }}>Remove</Button>}
                  </li>
                );
              })}
              {!rules.length && <li className="text-muted-foreground">No rules changed: this group follows the company policy.</li>}
            </ul>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={pk.rule ?? ""} onValueChange={(rule) => setPick((p) => ({ ...p, [k]: { ...pk, rule } }))}>
                  <SelectTrigger className="h-7 text-xs w-80"><SelectValue placeholder="Change a rule for this group…" /></SelectTrigger>
                  <SelectContent>{OVERRIDABLE.flatMap((s) => flatten(sectionValue(data, s.key)).map(([f]) => `${s.key}:${f}`)).map((r) => <SelectItem key={r} value={r} className="text-xs">{ruleLabel(r)}</SelectItem>)}</SelectContent>
                </Select>
                <Input aria-label="Value for the group" value={pk.value ?? ""} placeholder="value" inputMode="decimal" className="h-7 text-xs w-24"
                  onChange={(e) => setPick((p) => ({ ...p, [k]: { ...pk, value: e.target.value.replace(/[^0-9.]/g, "") } }))} />
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!pk.rule || !pk.value} onClick={() => {
                  const [section, field] = pk.rule!.split(":");
                  const s = section.slice("policy.".length);
                  setGroup(k, { ...g, overrides: { ...g.overrides, [s]: { ...(g.overrides[s] ?? {}), [field]: fromShown(pk.value!, fieldInfo(section, field).kind) } } });
                  setPick((p) => ({ ...p, [k]: {} }));
                }}>Add rule</Button>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-muted-foreground">Customers in this group ({members.length})</p>
              <div className="flex flex-wrap gap-1">
                {members.map((c) => (
                  <span key={c.id} className="rounded-full border px-2 py-0.5">{c.company_name}
                    {canEdit && <button type="button" className="ml-1 text-muted-foreground hover:text-foreground" aria-label={`Take ${c.company_name} out of ${g.name}`} onClick={() => assign.mutate({ id: c.id, group: null })}>×</button>}
                  </span>
                ))}
              </div>
              {canEdit && k in stored && (
                <Select value={pk.customer ?? ""} onValueChange={(id) => { assign.mutate({ id, group: k }); setPick((p) => ({ ...p, [k]: { ...pk, customer: undefined } })); }}>
                  <SelectTrigger className="h-7 text-xs w-80"><SelectValue placeholder="Add a customer…" /></SelectTrigger>
                  <SelectContent>{others.map((c) => <SelectItem key={c.id} value={c.id} className="text-xs">{c.company_name}{c.policy_group ? ` (now ${groups[c.policy_group]?.name ?? c.policy_group})` : ""}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {canEdit && !(k in stored) && <p className="text-muted-foreground">Save the groups first, then add customers.</p>}
            </div>
          </div>
        );
      })}
      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
            let n = 1; while (`group_${n}` in groups) n++;
            setGroups((all) => ({ ...all, [`group_${n}`]: { name: "New group", note: "", overrides: {} } }));
          }}><Plus className="h-3 w-3 mr-1" />Add a group</Button>
          <Button size="sm" className="h-7 text-xs" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save groups</Button>
        </div>
      )}
    </section>
  );
}

export function CreditPolicyPanel({ data, canEdit }: { data: SettingsAnswer; canEdit: boolean }) {
  return (
    <div className="space-y-5">
      <section className="bg-card rounded-xl border p-4 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Your Trade Credit Policy</h2>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
            const md = policyMarkdown((k) => sectionValue(data, k), ((data.settings as Record<string, unknown>).policy_groups ?? {}) as Record<string, PolicyGroup>, new Date().toISOString().slice(0, 10));
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
            a.download = "trade-credit-policy.md";
            a.click();
            URL.revokeObjectURL(a.href);
          }}><Download className="h-3 w-3 mr-1" />Download policy</Button>
        </div>
        <p className="text-muted-foreground">Every alert, limit proposal and answer in CreditPilot follows these rules. Set them to match your business and your written credit policy; CreditPilot's defaults are a starting point, not an industry standard. Each change is kept in the settings history with who made it.</p>
        {data.demo && <p className="rounded-md bg-muted px-3 py-2">In the demo the policy is read-only: it shows CreditPilot's defaults. On your own install your team sets it.</p>}
        <p className="font-medium pt-1">Score scale (0–100, higher is safer)</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
          {SCALE.map(([range, label]) => <div key={label} className="rounded border px-2 py-1"><div className="font-medium">{label}</div><div className="text-muted-foreground">{range}</div></div>)}
        </div>
      </section>
      {POLICY_SECTIONS.map((s) => <Section key={s.key} info={s} data={data} canEdit={canEdit} />)}
      <Groups data={data} canEdit={canEdit} />
    </div>
  );
}
