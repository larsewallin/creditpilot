/**
 * "Find the company": searches official company registers through Company Lookup
 * (github.com/larsewallin/company-lookup) and hands the chosen company's fields to
 * the application form, each with its source and the date it was checked.
 * Flags are prompts to review, never a verdict.
 */
import { useState } from "react";
import { Loader2, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callOnboarding } from "@/lib/onboarding";

export interface LookupPrefill {
  company_id: string;
  legal_name?: string;
  country_code?: string;
  registration_no?: string;
  cik?: string;
  lei?: string;
  website?: string;
  date_established?: string;
  registered_address?: string;
  is_public?: boolean;
  sources: { field: string; source: string; checked: string }[];
  verdict: "stop" | "check" | "clear";
  flags: { level: string; label: string; detail?: string }[];
}

interface Result { id: string; name: string; country: string | null; source: string; number?: string | null; status?: string | null; city?: string | null }

const FIELD_LABEL: Record<string, string> = {
  legal_name: "legal name", country_code: "country", registration_no: "registration number", cik: "SEC number (CIK)",
  lei: "LEI", website: "website", date_established: "established", registered_address: "registered address", is_public: "listed",
};

export function CompanyLookupSearch({ country, onPick }: { country: string; onPick: (p: LookupPrefill) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<"search" | string | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<LookupPrefill | null>(null);

  const search = async () => {
    setBusy("search"); setError(""); setResults(null);
    try {
      const r = await callOnboarding<{ results: Result[]; warnings: string[] }>({ action: "lookup_search", q, country: /^[A-Za-z]{2}$/.test(country) ? country : undefined });
      setResults(r.results); setWarnings(r.warnings ?? []);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  };

  const pick = async (id: string) => {
    setBusy(id); setError("");
    try {
      const r = await callOnboarding<{ prefill: LookupPrefill }>({ action: "lookup_card", id });
      setPicked(r.prefill); setResults(null); onPick(r.prefill);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  };

  return (
    <div className="sm:col-span-2 space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-xs font-medium">Find the company in official registers</p>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company name, registration number, LEI or ticker"
          className="h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (q.trim().length >= 2) search(); } }} />
        <Button type="button" size="sm" variant="outline" onClick={search} disabled={q.trim().length < 2 || busy !== null}>
          {busy === "search" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          <span className="ml-1">Search</span>
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Searches the country above plus the global LEI register. Uses Company Lookup; you can still type every field by hand.</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {warnings.map((w) => <p key={w} className="text-[10px] text-muted-foreground">{w}</p>)}
      {results && results.length === 0 && <p className="text-xs text-muted-foreground">No match. Try another spelling, the registration number, or another country.</p>}
      {results && results.length > 0 && (
        <ul className="divide-y rounded border text-xs max-h-64 overflow-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => pick(r.id)} disabled={busy !== null}
                className="w-full text-left px-2 py-1.5 hover:bg-secondary/60 flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground"> · {[r.country, r.city, r.number, r.status].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : r.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="text-[11px] space-y-1">
          <p className="flex items-center gap-1">
            {picked.verdict === "clear" ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />}
            <span>Filled from Company Lookup · company ID <code>{picked.company_id}</code></span>
          </p>
          <p className="text-muted-foreground">
            {picked.sources.map((s) => `${FIELD_LABEL[s.field] ?? s.field}: ${s.source}, checked ${s.checked}`).join(" · ")}
          </p>
          {picked.registered_address && <p className="text-muted-foreground">Registered address: {picked.registered_address}</p>}
          {picked.flags.filter((f) => f.level === "stop" || f.level === "check").map((f) => (
            <p key={f.label} className={f.level === "stop" ? "text-destructive" : "text-amber-700"}>
              {f.level === "stop" ? "Review first: " : "Check: "}{f.label}{f.detail ? ` (${f.detail})` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
