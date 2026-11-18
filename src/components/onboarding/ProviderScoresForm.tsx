/**
 * Scores from the credit providers a company uses (D&B, Creditsafe, Coface, Allianz Trade,
 * Experian, another), typed from the provider's report. Settings › Credit score source
 * decides which one counts; this form only records them.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileUp, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callOnboarding, getSettings } from "@/lib/onboarding";

export interface ProviderScoreRow { provider: string; raw: string; as_of: string; max_credit_usd: string; name: string; report?: { path: string; file_name: string } }

/** Sends a provider's report to the onboarding function (private storage); returns where it is kept. */
async function uploadReport(file: File): Promise<{ path: string; file_name: string }> {
  if (file.size > 10 * 1024 * 1024) throw new Error("The report is over 10 MB");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return callOnboarding({ action: "upload_report", content_type: file.type, file_name: file.name, data_base64: btoa(bin) });
}

function ReportUpload({ value, onChange }: { value?: { path: string; file_name: string }; onChange: (r?: { path: string; file_name: string }) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 sm:col-span-5">
      <label className={`inline-flex items-center gap-1 rounded-md border px-2 h-8 cursor-pointer hover:bg-muted ${busy ? "opacity-50 pointer-events-none" : ""}`}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
        {value ? "Replace the report" : "Attach the provider's report (PDF, PNG or JPEG, up to 10 MB)"}
        <input type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try { onChange(await uploadReport(file)); toast.success("Report attached"); }
          catch (err) { toast.error((err as Error).message); }
          finally { setBusy(false); }
        }} />
      </label>
      {value && <span className="text-muted-foreground truncate">{value.file_name}</span>}
    </div>
  );
}
export const EMPTY_PROVIDER_ROW: ProviderScoreRow = { provider: "", raw: "", as_of: "", max_credit_usd: "", name: "" };

export function ProviderScoresForm({ rows, onChange }: { rows: ProviderScoreRow[]; onChange: (rows: ProviderScoreRow[]) => void }) {
  const q = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 60_000 });
  const providers = (q.data?.score_providers ?? []).filter((p) => p.id !== "keen");
  const order = (q.data?.settings.sources.score_order ?? []).filter((id) => id !== "bureau_report");
  const name = (id: string) => q.data?.score_providers.find((p) => p.id === id)?.name ?? id;
  const set = (i: number, k: keyof ProviderScoreRow, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        {order.length ? <>Score used, in this order: {order.map(name).join(", then ")}. </> : null}
        <Link to="/settings" className="text-primary underline">Change in Settings</Link>.
      </p>
      {rows.map((r, i) => {
        const p = providers.find((x) => x.id === r.provider);
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_1fr_auto] items-end">
            <label className="block space-y-1"><span className="text-muted-foreground">Provider</span>
              <Select value={r.provider} onValueChange={(v) => set(i, "provider", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{providers.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select></label>
            <label className="block space-y-1"><span className="text-muted-foreground">{p ? p.scale : "Score or grade"}</span>
              <Input value={r.raw} onChange={(e) => set(i, "raw", e.target.value)} className="h-8 text-xs" /></label>
            <label className="block space-y-1"><span className="text-muted-foreground">Report date</span>
              <Input value={r.as_of} placeholder="YYYY-MM-DD" onChange={(e) => set(i, "as_of", e.target.value)} className="h-8 text-xs" /></label>
            <label className="block space-y-1"><span className="text-muted-foreground">Their credit recommendation (USD)</span>
              <Input value={r.max_credit_usd} inputMode="numeric" onChange={(e) => set(i, "max_credit_usd", e.target.value)} className="h-8 text-xs" /></label>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
            <ReportUpload value={r.report} onChange={(report) => onChange(rows.map((x, j) => (j === i ? { ...x, report } : x)))} />
            {r.provider === "other" && (
              <label className="block space-y-1 sm:col-span-2"><span className="text-muted-foreground">Provider's name</span>
                <Input value={r.name} onChange={(e) => set(i, "name", e.target.value)} className="h-8 text-xs" /></label>
            )}
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange([...rows, { ...EMPTY_PROVIDER_ROW }])}><Plus className="h-3.5 w-3.5 mr-1" />Add another provider's report</Button>
    </div>
  );
}

export function toProviderScores(rows: ProviderScoreRow[]) {
  const n = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(/[^0-9.]/g, "")));
  return rows.filter((r) => r.provider && r.raw.trim()).map((r) => ({
    provider: r.provider, raw: r.raw.trim(), as_of: r.as_of || undefined, max_credit_usd: n(r.max_credit_usd), name: r.name || undefined,
    ...(r.report ? { report: r.report } : {}),
  }));
}

export function fromProviderScores(list: any[] | undefined): ProviderScoreRow[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (list ?? []).map((x) => ({ provider: x.provider ?? "", raw: String(x.raw ?? ""), as_of: x.as_of ?? "", max_credit_usd: x.max_credit_usd != null ? String(x.max_credit_usd) : "", name: x.name ?? "", ...(x.report ? { report: x.report } : {}) }));
}
