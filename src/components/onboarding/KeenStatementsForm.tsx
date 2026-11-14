/**
 * A private company's statements, entered by the credit team from the accounts the customer sent.
 * The lines and questions come from Keen (GET /v1/template through the onboarding function), so the
 * form always matches what Keen scores. The same figures feed the limit caps.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callOnboarding } from "@/lib/onboarding";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TemplateLine { key: string; label: string; sheet: string; scored: boolean; required: boolean; computed?: boolean; part_of?: string; check?: boolean; bank?: boolean; lease?: boolean }
interface Template {
  version: string; lines: TemplateLine[]; prior_keys: string[]; units: string[]; bases: string[];
  subsectors: { id: string; name: string; industry: string }[];
  rules: { minimum_points_with_input: number; stale_months: number };
}
export interface KeenStatements { version: string; answers: Record<string, any>; current: Record<string, { value: number | null; status: string }>; prior: Record<string, { value: number | null; status: string }>; earlierYears: unknown[] }

const SHEETS = ["Income statement", "Balance sheet", "Cash-flow statement", "Fixed assets"];
const FRAMEWORKS = ["US GAAP", "IFRS", "tax basis", "cash basis", "other"];
const DEFAULT_ANSWERS = {
  framework: "US GAAP", currency: "USD", units: "dollars", basis: "reviewed", hasCashFlowStatement: true, yearsOfAccounts: 3,
  takesDeposits: false, bankruptcy: { filed: false }, goingConcern: { stated: false },
};

const toNum = (s: string | undefined) => {
  if (s === undefined || s.trim() === "") return null;
  const t = s.trim().replace(/^\((.*)\)$/, "-$1").replace(/[,\s$]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const oneYearBefore = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const x = new Date(`${d}T00:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() - 1);
  return x.toISOString().slice(0, 10);
};
const dayAfterYearBefore = (d: string) => {
  const p = oneYearBefore(d);
  if (!p) return "";
  const x = new Date(`${p}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** `initial` is read once; remount with a new `key` to load other figures (e.g. a sample). */
export function KeenStatementsForm({ initial, onChange }: { initial: KeenStatements | null; onChange: (v: KeenStatements | null) => void }) {
  const value = initial;
  const tq = useQuery({ queryKey: ["keen-template"], queryFn: () => callOnboarding<Template>({ action: "keen_template" }), staleTime: 3_600_000, retry: 1 });
  const t = tq.data;

  // Inputs are kept as typed text; the template object is rebuilt from them on every change.
  const [answers, setAnswers] = useState<Record<string, any>>(() => ({ ...DEFAULT_ANSWERS, ...(value?.answers ?? {}) }));
  const [cur, setCur] = useState<Record<string, string>>(() => fromCells(value?.current));
  const [pri, setPri] = useState<Record<string, string>>(() => fromCells(value?.prior));
  const [none, setNone] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.entries(value?.current ?? {}).filter(([, c]) => c.status === "none").map(([k]) => [k, true])));
  const [showChecks, setShowChecks] = useState(false);

  const lines = useMemo(() => (t?.lines ?? []).filter((l) => !l.bank), [t]);
  const priorKeys = useMemo(() => new Set(t?.prior_keys ?? []), [t]);

  useEffect(() => {
    if (!t) return;
    const fye = answers.fiscalYearEnd ?? "";
    if (!fye && !Object.values(cur).some((s) => s?.trim())) { onChange(null); return; }
    const current = Object.fromEntries(t.lines.map((l) => {
      const v = toNum(cur[l.key]);
      return [l.key, v !== null ? { value: v, status: "value" } : { value: null, status: none[l.key] || l.bank ? "none" : "notProvided" }];
    }));
    const prior = Object.fromEntries([...priorKeys].map((k) => {
      const v = toNum(pri[k]);
      return [k, v !== null ? { value: v, status: "value" } : { value: null, status: "notProvided" }];
    }));
    onChange({
      version: t.version,
      answers: { ...answers, fiscalYearStart: answers.fiscalYearStart || dayAfterYearBefore(fye), priorYearEnd: answers.priorYearEnd || oneYearBefore(fye) },
      current, prior, earlierYears: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, answers, cur, pri, none]);

  if (tq.isLoading) return <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Loading Keen's statement lines…</p>;
  if (tq.isError || !t) return <p className="text-xs text-amber-700">{(tq.error as Error)?.message ?? "Keen's statement lines are unavailable"}. The application can still be submitted; Keen will not score it.</p>;

  const setA = (k: string, v: any) => setAnswers((a) => ({ ...a, [k]: v }));
  const yesNo = (k: string, label: string, get: (a: any) => boolean, set: (b: boolean) => any) => (
    <label className="block text-xs space-y-1"><span className="text-muted-foreground">{label}</span>
      <Select value={get(answers) ? "yes" : "no"} onValueChange={(v) => setA(k, set(v === "yes"))}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent>
      </Select></label>
  );
  const pick = (k: string, label: string, options: { v: string; l: string }[]) => (
    <label className="block text-xs space-y-1"><span className="text-muted-foreground">{label}</span>
      <Select value={answers[k] ?? ""} onValueChange={(v) => setA(k, v)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
      </Select></label>
  );
  const date = (k: string, label: string, placeholder?: string) => (
    <label className="block text-xs space-y-1"><span className="text-muted-foreground">{label}</span>
      <Input value={answers[k] ?? ""} placeholder={placeholder} onChange={(e) => setA(k, e.target.value)} className="h-8 text-xs" /></label>
  );
  const fye = answers.fiscalYearEnd ?? "";
  const industries = [...new Set(t.subsectors.map((s) => s.industry))];

  const row = (l: TemplateLine) => (
    <tr key={l.key} className="border-t">
      <td className="py-1 pr-2">{l.label}{l.required && <span className="text-destructive"> *</span>}</td>
      <td className="py-1 w-36"><Input value={cur[l.key] ?? ""} onChange={(e) => setCur((x) => ({ ...x, [l.key]: e.target.value }))} className="h-7 text-xs text-right font-mono" inputMode="decimal" /></td>
      <td className="py-1 w-36">{priorKeys.has(l.key) && <Input value={pri[l.key] ?? ""} onChange={(e) => setPri((x) => ({ ...x, [l.key]: e.target.value }))} className="h-7 text-xs text-right font-mono" inputMode="decimal" />}</td>
      <td className="py-1 pl-2 w-20 text-center">
        {!(cur[l.key] ?? "").trim() && <label className="inline-flex items-center gap-1 text-muted-foreground"><input type="checkbox" checked={!!none[l.key]} onChange={(e) => setNone((x) => ({ ...x, [l.key]: e.target.checked }))} />None</label>}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4 text-xs">
      <div className="grid gap-3 sm:grid-cols-3">
        {date("fiscalYearEnd", "Financial year end (YYYY-MM-DD) *", "2025-12-31")}
        {date("fiscalYearStart", "Year start", dayAfterYearBefore(fye) || "YYYY-MM-DD")}
        {date("priorYearEnd", "Prior year end", oneYearBefore(fye) || "YYYY-MM-DD")}
        {pick("basis", "Basis", t.bases.map((b) => ({ v: b, l: b === "management" ? "management accounts" : b })))}
        {pick("units", "Figures in", t.units.map((u) => ({ v: u, l: u })))}
        {pick("framework", "Accounting framework", FRAMEWORKS.map((f) => ({ v: f, l: f })))}
        <label className="block text-xs space-y-1"><span className="text-muted-foreground">Currency</span>
          <Input value={answers.currency ?? ""} maxLength={3} onChange={(e) => setA("currency", e.target.value.toUpperCase())} className="h-8 text-xs" /></label>
        <label className="block text-xs space-y-1 sm:col-span-2"><span className="text-muted-foreground">Industry *</span>
          <Select value={answers.industry?.choice ?? ""} onValueChange={(v) => setA("industry", { choice: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose the company's sub-sector…" /></SelectTrigger>
            <SelectContent>{industries.map((ind) => t.subsectors.filter((s) => s.industry === ind).map((s) => (
              <SelectItem key={s.id} value={s.id}>{ind}: {s.name}</SelectItem>)))}</SelectContent>
          </Select></label>
        <label className="block text-xs space-y-1"><span className="text-muted-foreground">Years of annual accounts</span>
          <Input value={String(answers.yearsOfAccounts ?? "")} inputMode="numeric" onChange={(e) => setA("yearsOfAccounts", e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined)} className="h-8 text-xs" /></label>
        {yesNo("hasCashFlowStatement", "Accounts include a cash-flow statement", (a) => a.hasCashFlowStatement !== false, (b) => b)}
        {yesNo("takesDeposits", "Takes customer deposits (a bank or lender)", (a) => !!a.takesDeposits, (b) => b)}
        {yesNo("goingConcern", "Accounts or auditor state going-concern doubt", (a) => !!a.goingConcern?.stated, (b) => ({ stated: b }))}
        {yesNo("bankruptcy", "Bankruptcy or receivership filed in the last 12 months", (a) => !!a.bankruptcy?.filed, (b) => ({ filed: b, ...(b ? { date: answers.bankruptcy?.date ?? "" } : {}) }))}
        {answers.bankruptcy?.filed && (
          <label className="block text-xs space-y-1"><span className="text-muted-foreground">Filing date (YYYY-MM-DD)</span>
            <Input value={answers.bankruptcy?.date ?? ""} onChange={(e) => setA("bankruptcy", { filed: true, date: e.target.value })} className="h-8 text-xs" /></label>
        )}
      </div>

      <p className="text-muted-foreground">Type the figures as printed, in the units chosen; a bracketed figure is negative. Leave a line blank if it is not in the accounts, or tick None if the company has none. Keen needs at least {t.rules.minimum_points_with_input} of its 100 points covered, and only scores US GAAP accounts in US dollars.</p>

      {SHEETS.map((sheet) => {
        const rows = lines.filter((l) => l.sheet === sheet && !l.check);
        if (!rows.length) return null;
        return (
          <table key={sheet} className="w-full">
            <thead><tr className="text-muted-foreground text-left"><th className="py-1 font-semibold text-foreground">{sheet}</th><th className="text-right pr-2">This year</th><th className="text-right pr-2">Prior year</th><th /></tr></thead>
            <tbody>{rows.map(row)}</tbody>
          </table>
        );
      })}
      <button type="button" className="text-primary underline" onClick={() => setShowChecks((x) => !x)}>{showChecks ? "Hide" : "Show"} optional check lines</button>
      {showChecks && <table className="w-full"><tbody>{lines.filter((l) => l.check).map(row)}</tbody></table>}
    </div>
  );
}

function fromCells(cells?: Record<string, { value: number | null; status: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(cells ?? {}).filter(([, c]) => typeof c?.value === "number").map(([k, c]) => [k, String(c.value)]));
}
