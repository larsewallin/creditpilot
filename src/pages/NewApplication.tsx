/**
 * The credit team keys in a new customer's application (customers do not use CreditPilot).
 * "Load sample" fills a ready-made applicant. Submitting runs the whole pipeline and opens
 * the prospect page. Financials: a US-listed company's 10-K is read by Keen; any other
 * company's statements are entered here in Keen's lines and scored by Keen.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callOnboarding } from "@/lib/onboarding";
import { SAMPLE_APPLICATIONS } from "@/lib/onboardingSamples";
import { CompanyLookupSearch, type LookupPrefill } from "@/components/onboarding/CompanyLookupSearch";
import { KeenStatementsForm, type KeenStatements } from "@/components/onboarding/KeenStatementsForm";
import { ProviderScoresForm, toProviderScores, fromProviderScores, type ProviderScoreRow } from "@/components/onboarding/ProviderScoresForm";

/* eslint-disable @typescript-eslint/no-explicit-any */

const EMPTY = {
  legal_name: "", trade_name: "", country_code: "US", registration_no: "", tax_id: "", website: "", sector: "", entity_type: "corporation",
  date_established: "", is_public: false, ticker: "", cik: "", lei: "", company_id: "", address_type: "commercial",
  line1: "", city: "", postal_code: "",
  amount_usd: "", terms_days: "30", monthly_purchases_usd: "", invoicing_currency: "USD",
  people: "", trade_references: "",
  terms: true, credit_check_consent: true, personal_guarantee: false,
};
type Form = typeof EMPTY & {
  /** a private company's statements in Keen's lines */
  keen: KeenStatements | null;
  /** statements a sample carries in the older short form (kept as given, used for the caps only) */
  legacy_statements: any[];
  /** scores typed from third-party providers' reports */
  provider_scores: ProviderScoreRow[];
};
const EMPTY_FORM: Form = { ...EMPTY, keen: null, legacy_statements: [], provider_scores: [] };

function fromApplication(a: any): Form {
  return {
    ...EMPTY_FORM,
    legal_name: a.legal_name ?? "", trade_name: a.trade_name ?? "", country_code: a.country_code ?? "US", registration_no: a.registration_no ?? "",
    tax_id: a.tax_id ?? "", website: a.website ?? "", sector: a.sector ?? "", entity_type: a.entity_type ?? "corporation",
    date_established: a.date_established ?? "", is_public: !!a.is_public, ticker: a.ticker ?? "", cik: a.cik ?? "", lei: a.lei ?? "", company_id: a.company_id ?? "", address_type: a.address_type ?? "commercial",
    line1: a.billing_address?.line1 ?? "", city: a.billing_address?.city ?? "", postal_code: a.billing_address?.postal_code ?? "",
    amount_usd: String(a.credit_request?.amount_usd ?? ""), terms_days: String(a.credit_request?.terms_days ?? "30"),
    monthly_purchases_usd: String(a.credit_request?.monthly_purchases_usd ?? ""), invoicing_currency: a.credit_request?.invoicing_currency ?? "USD",
    people: (a.people ?? []).map((p: any) => `${p.name}, ${p.role}${p.ownership_pct ? `, ${p.ownership_pct}` : ""}`).join("\n"),
    trade_references: (a.trade_references ?? []).map((t: any) => t.company_name).join("\n"),
    keen: a.keen_statements ?? null, legacy_statements: a.financial_statements ?? [], provider_scores: fromProviderScores(a.provider_scores),
    terms: a.signatures?.terms ?? true, credit_check_consent: a.signatures?.credit_check_consent ?? true, personal_guarantee: !!a.signatures?.personal_guarantee,
  };
}

const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(/[^0-9.-]/g, "")));

/** A US-listed company with a ticker or SEC number: Keen reads its latest 10-K, so nothing is typed in. */
const keenReadsFiling = (f: Pick<Form, "is_public" | "country_code" | "ticker" | "cik">) =>
  f.is_public && f.country_code.toUpperCase() === "US" && !!(f.ticker.trim() || f.cik.trim());

function toApplication(f: Form) {
  const filing = keenReadsFiling(f);
  const keen = !filing && f.keen?.answers?.fiscalYearEnd ? f.keen : undefined;
  return {
    legal_name: f.legal_name.trim(), trade_name: f.trade_name || undefined, country_code: f.country_code.toUpperCase(),
    registration_no: f.registration_no || undefined, tax_id: f.tax_id || undefined, website: f.website || undefined,
    sector: f.sector || undefined, entity_type: f.entity_type, date_established: f.date_established || undefined,
    is_public: f.is_public, ticker: f.ticker || undefined, cik: f.cik || undefined, lei: f.lei || undefined, company_id: f.company_id || undefined, address_type: f.address_type,
    billing_address: f.line1 ? { line1: f.line1, city: f.city, postal_code: f.postal_code, country_code: f.country_code.toUpperCase() } : undefined,
    people: f.people.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, role, pct] = l.split(",").map((x) => x.trim());
      return { name, role: (["officer", "director", "owner", "guarantor"].includes(role) ? role : "officer"), ownership_pct: pct ? Number(pct) : undefined };
    }),
    credit_request: { amount_usd: num(f.amount_usd), terms_days: num(f.terms_days), monthly_purchases_usd: num(f.monthly_purchases_usd), invoicing_currency: f.invoicing_currency },
    trade_references: f.trade_references.split("\n").map((l) => l.trim()).filter(Boolean).map((company_name) => ({ company_name })),
    financial_statements: filing || keen ? [] : f.legacy_statements,
    keen_statements: keen,
    provider_scores: toProviderScores(f.provider_scores),
    signatures: { terms: f.terms, credit_check_consent: f.credit_check_consent, personal_guarantee: f.personal_guarantee },
  };
}

export default function NewApplication() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(EMPTY_FORM);
  const [formKey, setFormKey] = useState(0);
  const [sample, setSample] = useState<string>("");
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const submit = useMutation({
    mutationFn: () => callOnboarding<{ application_id: string }>({ action: "submit", application: toApplication(f) }),
    onSuccess: (r) => { qc.invalidateQueries(); toast.success("Submitted. The checks have run."); navigate(`/new-customers/${r.application_id}`); },
    onError: (e) => toast.error((e as Error).message),
  });

  const field = (k: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <label className="block text-xs space-y-1">
      <span className="text-muted-foreground">{label}</span>
      <Input value={String(f[k])} onChange={set(k)} className="h-8 text-xs" {...props} />
    </label>
  );
  const check = (k: keyof Form, label: string) => (
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!f[k]} onChange={set(k)} />{label}</label>
  );
  const chosen = SAMPLE_APPLICATIONS.find((s) => s.key === sample);
  // A company picked in Company Lookup fills the fields it states; anything else stays as typed.
  const fromLookup = (p: LookupPrefill) => setF((x) => ({
    ...x,
    company_id: p.company_id,
    legal_name: p.legal_name ?? x.legal_name,
    country_code: p.country_code ?? x.country_code,
    registration_no: p.registration_no ?? (p.cik ? "" : x.registration_no),
    cik: p.cik ?? "",
    lei: p.lei ?? "",
    website: p.website ?? x.website,
    date_established: p.date_established ?? x.date_established,
    is_public: p.is_public ?? x.is_public,
  }));

  return (
    <div className="space-y-5 pb-48 max-w-4xl">
      <Link to="/new-customers" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />New customers
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">New credit application</h1>
        <div className="flex items-center gap-2">
          <Select value={sample} onValueChange={(v) => { setSample(v); const s = SAMPLE_APPLICATIONS.find((x) => x.key === v); if (s) { setF(fromApplication(s.application)); setFormKey((k) => k + 1); } }}>
            <SelectTrigger className="h-8 w-72 text-xs"><SelectValue placeholder="Load sample application…" /></SelectTrigger>
            <SelectContent>{SAMPLE_APPLICATIONS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {chosen && <p className="text-xs text-muted-foreground">Expected: {chosen.expect}.</p>}

      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
        <section className="bg-card rounded-xl border p-4 grid gap-3 sm:grid-cols-2">
          <h2 className="sm:col-span-2 text-sm font-semibold">Company</h2>
          <CompanyLookupSearch country={f.country_code} onPick={fromLookup} />
          {field("legal_name", "Legal name *", { required: true })}
          {field("trade_name", "Trade name")}
          {field("country_code", "Country (2-letter code) *", { required: true, maxLength: 2 })}
          {field("registration_no", "Registration number (UK: Companies House no.)")}
          {field("tax_id", "Tax ID (US EIN or EU/UK VAT)")}
          {field("website", "Website")}
          {field("sector", "Sector")}
          {field("date_established", "Established (YYYY-MM-DD)")}
          {field("line1", "Billing address")}
          <div className="grid grid-cols-2 gap-3">{field("city", "City")}{field("postal_code", "Postcode")}</div>
          <div className="flex items-center gap-4 sm:col-span-2">{check("is_public", "Publicly listed")}{f.is_public && field("ticker", "Ticker (found from the SEC number if left blank)")}</div>
          {field("lei", "LEI (Legal Entity Identifier)")}
          {f.cik && field("cik", "SEC number (CIK)")}
        </section>

        <section className="bg-card rounded-xl border p-4 grid gap-3 sm:grid-cols-2">
          <h2 className="sm:col-span-2 text-sm font-semibold">Credit request</h2>
          {field("amount_usd", "Requested limit (USD) *", { required: true, inputMode: "numeric" })}
          {field("terms_days", "Payment terms (days)", { inputMode: "numeric" })}
          {field("monthly_purchases_usd", "Expected monthly purchases (USD)", { inputMode: "numeric" })}
          {field("invoicing_currency", "Invoicing currency", { maxLength: 3 })}
        </section>

        <section className="bg-card rounded-xl border p-4 grid gap-3 sm:grid-cols-2">
          <h2 className="sm:col-span-2 text-sm font-semibold">People and references</h2>
          <label className="block text-xs space-y-1"><span className="text-muted-foreground">Officers, directors, owners (one per line: Name, role, ownership %)</span>
            <Textarea value={f.people} onChange={set("people")} className="text-xs min-h-[90px]" /></label>
          <label className="block text-xs space-y-1"><span className="text-muted-foreground">Trade references (one company per line; at least 3)</span>
            <Textarea value={f.trade_references} onChange={set("trade_references")} className="text-xs min-h-[90px]" /></label>
        </section>

        {keenReadsFiling(f) ? (
        <section className="bg-card rounded-xl border p-4 space-y-1">
          <h2 className="text-sm font-semibold">Financials</h2>
          <p className="text-xs">From the company's latest 10-K at the SEC, scored by Keen. Nothing to enter.</p>
          <p className="text-xs text-muted-foreground">The score, the financial year end and how old the accounts are appear on the prospect page after you submit.</p>
        </section>
        ) : (
        <section className="bg-card rounded-xl border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Financial statements</h2>
          <p className="text-xs text-muted-foreground">From the accounts the customer sent you. Keen scores them; the same figures set the limit caps.{f.legacy_statements.length > 0 && !f.keen ? " This sample carries short-form figures for the caps only." : ""}</p>
          <KeenStatementsForm key={formKey} initial={f.keen} onChange={(keen) => setF((x) => ({ ...x, keen }))} />
        </section>
        )}

        <section className="bg-card rounded-xl border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Scores from other credit providers (optional)</h2>
          <ProviderScoresForm rows={f.provider_scores} onChange={(provider_scores) => setF((x) => ({ ...x, provider_scores }))} />
        </section>

        <section className="bg-card rounded-xl border p-4 space-y-2">
          <h2 className="text-sm font-semibold">Signed by the customer</h2>
          {check("terms", "Customer has accepted the terms and conditions")}
          {check("credit_check_consent", "Customer has consented to credit checks")}
          {check("personal_guarantee", "Customer has signed a personal guarantee (needed for companies under 24 months old)")}
        </section>

        <Button type="submit" disabled={submit.isPending || !f.legal_name || !f.amount_usd}>
          {submit.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Submit and run checks
        </Button>
        {submit.isPending && <p className="text-xs text-muted-foreground">Screening and analysis take up to a minute.</p>}
      </form>
    </div>
  );
}
