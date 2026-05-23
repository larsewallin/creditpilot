/**
 * @skill fetch-sec-filing
 * @type integration
 * @description Fetches recent SEC filings for a company via the SEC EDGAR API.
 *   EDGAR is free and requires no API key.
 *   Returns [] silently on failure.
 *   Adding a new provider: implement SecFilingProvider interface only.
 * @usedBy sec-monitor-agent
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SecFiling {
  cik: string;              // stored in sec_filings.cik
  company_name: string;     // not stored in sec_filings (resolved via customers join)
  filing_type: "10-K" | "10-Q" | "8-K" | "other";
  filing_date: string;        // ISO date
  accession_number: string;   // EDGAR unique ID e.g. "0001021162-24-000001"
  document_url: string;       // direct link to filing
  risk_signals: string[];     // detected risk keyword signals
  key_findings: string;       // brief summary of findings
  provider: "edgar";          // stored in sec_filings.provider
}

export interface SecFilingProvider {
  name: string;
  fetchFilings(cik: string, daysBack?: number): Promise<SecFiling[]>;
}

// ─── Risk keyword detection ───────────────────────────────────────────────────

const RISK_KEYWORDS: Record<string, string> = {
  "going concern":        "going_concern_warning",
  "substantial doubt":    "going_concern_warning",
  "covenant waiver":      "covenant_waiver",
  "waiver of covenant":   "covenant_waiver",
  "covenant breach":      "covenant_waiver",
  "chief executive officer resigned": "CEO_departure",
  "ceo resigned":         "CEO_departure",
  "ceo departure":        "CEO_departure",
  "cash runway":          "cash_runway_<3_quarters",
  "material weakness":    "material_weakness",
  "restatement":          "restatement",
  "sec investigation":    "sec_investigation",
  "pension underfunding": "pension_underfunding",
  "strategic review":     "strategic_review",
  "revenue miss":         "revenue_miss",
};

export function detectRiskSignals(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [keyword, signal] of Object.entries(RISK_KEYWORDS)) {
    if (lower.includes(keyword)) found.add(signal);
  }
  return [...found];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function mapFilingType(form: string): "10-K" | "10-Q" | "8-K" | "other" {
  if (form.startsWith("10-K")) return "10-K";
  if (form.startsWith("10-Q")) return "10-Q";
  if (form.startsWith("8-K"))  return "8-K";
  return "other";
}

const EDGAR_UA = "CreditPilot/1.0 contact@creditpilot.dev";

// ─── EDGAR provider ───────────────────────────────────────────────────────────

export class EdgarProvider implements SecFilingProvider {
  readonly name = "edgar";

  async fetchFilings(cik: string, daysBack = 90): Promise<SecFiling[]> {
    try {
      const paddedCik = cik.padStart(10, "0");
      const submissionsUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

      const subResp = await fetch(submissionsUrl, {
        headers: { "User-Agent": EDGAR_UA },
      });
      if (!subResp.ok) return [];

      const sub = await subResp.json();
      const companyName: string = sub.name ?? "";
      const recent = sub.filings?.recent;
      if (!recent) return [];

      const forms: string[]   = recent.form            ?? [];
      const dates: string[]   = recent.filingDate      ?? [];
      const accNos: string[]  = recent.accessionNumber ?? [];

      const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      const results: SecFiling[] = [];

      for (let i = 0; i < forms.length; i++) {
        const filingType = mapFilingType(forms[i]);
        if (filingType === "other") continue;

        const filingDate = dates[i];
        if (!filingDate) continue;
        if (new Date(filingDate) < cutoff) continue;

        const accessionNumber = accNos[i] ?? "";
        const accClean        = accessionNumber.replace(/-/g, "");
        const documentUrl     = `https://www.sec.gov/Archives/edgar/data/${cik}/${accClean}/`;

        let riskSignals: string[] = [];
        let keyFindings = "";

        try {
          // Fetch filing index JSON to locate the main document
          const indexUrl = `https://data.sec.gov/Archives/edgar/data/${cik}/${accClean}/${accessionNumber}-index.json`;
          const indexResp = await fetch(indexUrl, { headers: { "User-Agent": EDGAR_UA } });

          if (indexResp.ok) {
            const index = await indexResp.json();
            const mainDoc = (index.documents ?? []).find(
              (d: any) => d.type === forms[i] && d.document?.endsWith(".htm")
            );

            if (mainDoc) {
              const docResp = await fetch(`https://www.sec.gov${mainDoc.document}`, {
                headers: { "User-Agent": EDGAR_UA },
              });
              if (docResp.ok) {
                const raw     = await docResp.text();
                const stripped = stripHtml(raw).slice(0, 10000);
                riskSignals   = detectRiskSignals(stripped);
                keyFindings   = stripped.slice(0, 500);
              }
            }
          }
        } catch {
          // Filing text fetch failure is non-fatal — still return the filing
        }

        results.push({
          cik,
          company_name: companyName,
          filing_type: filingType,
          filing_date: filingDate,
          accession_number: accessionNumber,
          document_url: documentUrl,
          risk_signals: riskSignals,
          key_findings: keyFindings,
          provider: "edgar",
        });
      }

      return results;
    } catch {
      return [];
    }
  }
}

// ─── Main fetch function ──────────────────────────────────────────────────────

export async function fetchSecFilings(input: {
  cik: string;
  company_name: string;
  days_back?: number;
  providers?: SecFilingProvider[];
}): Promise<SecFiling[]> {
  const providers = input.providers ?? [new EdgarProvider()];

  const results = await Promise.allSettled(
    providers.map((p) => p.fetchFilings(input.cik, input.days_back))
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<SecFiling[]>).value);
}

// ─── Seed fetch function (demo mode) ─────────────────────────────────────────
//
// Reads from seed_sec_filings instead of hitting live EDGAR, so demo runs the
// real SEC agent pipeline deterministically. days_back is intentionally ignored:
// seed rows are curated demo fixtures and should always be returned regardless
// of their filing_date age.

export async function fetchSeedSecFilings(input: {
  cik: string;
  company_name?: string;
  days_back?: number;
}): Promise<SecFiling[]> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return [];

    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from("seed_sec_filings")
      .select("cik, company_name, filing_type, filing_date, accession_number, document_url, risk_signals, key_findings, provider")
      .eq("cik", input.cik);

    if (error || !data) return [];

    return data.map((row) => ({
      cik:              row.cik,
      company_name:     row.company_name,
      filing_type:      mapFilingType(row.filing_type) as SecFiling["filing_type"],
      filing_date:      row.filing_date,
      accession_number: row.accession_number,
      document_url:     row.document_url,
      risk_signals:     row.risk_signals ?? [],
      key_findings:     row.key_findings ?? "",
      provider:         "edgar",
    }));
  } catch {
    return [];
  }
}
