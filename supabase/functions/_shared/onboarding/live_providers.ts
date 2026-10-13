/**
 * Production adapters for the onboarding pipeline (OnboardingProviders).
 *
 * Every source fails soft (records a gap and lets the pipeline fall back),
 * except sanctions, which fails closed: if the lists cannot be read or are
 * stale, screening throws and the application waits at Screening.
 *
 * Sources (free or already licensed):
 *   Companies House (GB registry, officers, PSC owners)   COMPANIES_HOUSE_API_KEY
 *   SEC EDGAR (US public: submissions + XBRL companyfacts) keyless, User-Agent required
 *   GLEIF (LEI registry, any country; absence is not evidence)
 *   VIES (EU VAT), HMRC (GB VAT)                          HMRC_CLIENT_ID / HMRC_CLIENT_SECRET (optional)
 *   RDAP (domain registration date)
 *   FMP (non-US public financials)                        FMP_API_KEY (optional)
 *   File scoring app                                      FILE_API_URL / FILE_API_KEY (optional)
 *   sanctions_entries table (filled daily by sanctions-sync)
 *   credit_events (Country, FX, Industry agents)
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import type {
  CreditApplication, ExistingCustomerMatch, FinancialStatement, MacroContextEvent, OnboardingProviders,
  Person, ProviderError, RegistryRecord, SanctionsEntry, ScoreResult, TaxIdCheck,
} from "./types.ts";
import { normalize } from "../skills/analytical/match-sanctions-name.ts";

export interface LiveDeps {
  db: SupabaseClient;
  env: (key: string) => string | undefined;
  fetch?: typeof fetch;
  asOf?: string;            // ISO date, for staleness and domain age
  isDemo?: boolean;         // which credit_events to read for macro context
  timeoutMs?: number;
  /** The application's own prospect: never report it as an existing customer of itself. */
  excludeCustomerId?: string;
}

const SEC_UA = "CreditPilot onboarding (contact: credit-ops@creditpilot.app)";
const SANCTIONS_MAX_AGE_DAYS = 3;
const SANCTIONS_LISTS = ["OFAC_SDN", "OFAC_CONS", "EU", "UK", "UN"] as const;
const VIES_COUNTRIES = new Set(["AT","BE","BG","CY","CZ","DE","DK","EE","EL","GR","ES","FI","FR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"]);

export function liveProviders(deps: LiveDeps): OnboardingProviders {
  const f = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;

  async function get(url: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { return await f(url, { ...init, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
  }
  async function getJson<T>(url: string, init: RequestInit = {}): Promise<T | null> {
    try {
      const r = await get(url, init);
      if (!r.ok) return null;
      return await r.json() as T;
    } catch { return null; }
  }

  return {
    // ─── Existing customer (never create a duplicate) ────────────────────────
    async findExistingCustomer(app): Promise<ExistingCustomerMatch | null> {
      const probes: [ExistingCustomerMatch["matched_on"], string | undefined][] = [
        ["duns", app.duns], ["tax_id", app.tax_id],
      ];
      for (const [type, raw] of probes) {
        if (!raw) continue;
        const values = [...new Set([raw, normId(raw)])];
        const { data } = await deps.db.from("customer_identifiers")
          .select("customer_id, customers(company_name, lifecycle_status)")
          .eq("id_type", type).in("id_value", values).limit(5);
        const row = (data as { customer_id: string; customers?: { company_name?: string } }[] | null)
          ?.find((r) => r.customer_id !== deps.excludeCustomerId);
        if (row) return { customer_id: row.customer_id, company_name: row.customers?.company_name ?? "", matched_on: type };
      }
      return null;
    },

    // ─── Registry ─────────────────────────────────────────────────────────────
    async lookupRegistry(app): Promise<RegistryRecord> {
      const cc = app.country_code?.toUpperCase();
      if (cc === "GB") return companiesHouse(app);
      if (app.is_public && (app.cik || app.ticker)) {
        const sec = await secRegistry(app);
        if (sec) return sec;
      }
      return gleif(app);
    },

    // ─── Tax ID ───────────────────────────────────────────────────────────────
    async checkTaxId(app): Promise<TaxIdCheck | null> {
      if (!app.tax_id) return null;
      const cc = app.country_code?.toUpperCase();
      if (cc === "US") return { source: "ein_format", valid: /^\d{2}-?\d{7}$/.test(app.tax_id.trim()) && !app.tax_id.startsWith("00") };
      if (cc === "GB") return hmrcVat(app.tax_id);
      const vatCc = cc === "GR" ? "EL" : cc;
      if (vatCc && VIES_COUNTRIES.has(vatCc)) return vies(vatCc, app.tax_id);
      return null;
    },

    // ─── Domain age (RDAP) ────────────────────────────────────────────────────
    async domainAgeMonths(website): Promise<number | null> {
      const host = website.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].replace(/^www\./i, "").toLowerCase();
      if (!host.includes(".")) return null;
      const r = await getJson<{ events?: { eventAction: string; eventDate: string }[] }>(`https://rdap.org/domain/${encodeURIComponent(host)}`, { redirect: "follow" });
      const reg = r?.events?.find((e) => e.eventAction === "registration")?.eventDate;
      if (!reg) return null;
      return monthsBetween(reg, deps.asOf ?? new Date().toISOString());
    },

    // ─── Sanctions (fail closed) ──────────────────────────────────────────────
    async sanctionsList(subjects: string[] = []): Promise<SanctionsEntry[]> {
      const { data: runs, error: runErr } = await deps.db.from("sanctions_list_status").select("list, last_success_at");
      if (runErr) throw new Error(`Sanctions lists unavailable: ${runErr.message}`);
      const now = Date.parse(deps.asOf ?? new Date().toISOString());
      for (const list of SANCTIONS_LISTS) {
        const row = (runs ?? []).find((r: { list: string }) => r.list === list) as { last_success_at?: string } | undefined;
        if (!row?.last_success_at) throw new Error(`Sanctions list ${list} has never been loaded`);
        if ((now - Date.parse(row.last_success_at)) / 86_400_000 > SANCTIONS_MAX_AGE_DAYS) {
          throw new Error(`Sanctions list ${list} is older than ${SANCTIONS_MAX_AGE_DAYS} days`);
        }
      }
      if (!subjects.length) return [];
      const names = [...new Set(subjects.flatMap((n) => [normalize(n, "person").join(" "), normalize(n, "entity").join(" ")]).filter(Boolean))];
      const { data, error } = await deps.db.rpc("fn_sanctions_candidates", { p_names: names, p_min_similarity: 0.3 });
      if (error) throw new Error(`Sanctions candidate search failed: ${error.message}`);
      return (data ?? []).map((r: Record<string, unknown>) => ({
        list: r.list as SanctionsEntry["list"], name: r.name as string, type: r.entry_type as "entity" | "person",
        aliases: (r.aliases as string[] | null) ?? [], country_code: (r.country_code as string | null) ?? undefined,
        date_of_birth: (r.date_of_birth as string | null) ?? undefined, list_id: r.list_id as string,
      }));
    },

    // ─── Public financials (EDGAR, then FMP) ──────────────────────────────────
    async publicFinancials(app): Promise<FinancialStatement[] | ProviderError> {
      const cik = app.cik ?? (app.ticker ? await tickerToCik(app.ticker) : undefined);
      if (cik) {
        const s = await edgarFinancials(cik);
        if (s) return [s];
      }
      const key = deps.env("FMP_API_KEY");
      if (app.ticker && key) {
        const s = await fmpFinancials(app.ticker, key);
        if (s) return [s];
      }
      return { error: "not_found" };
    },

    // ─── File scoring app ─────────────────────────────────────────────────────
    async fileScore(app, financials): Promise<ScoreResult | ProviderError> {
      const base = deps.env("FILE_API_URL"), key = deps.env("FILE_API_KEY");
      if (!base || !key) return { error: "unavailable" };
      return fileScore(base.replace(/\/$/, ""), key, app, financials ?? app.financial_statements);
    },

    // ─── Macro context from the existing agents ───────────────────────────────
    async macroContext(country, sector, currency): Promise<MacroContextEvent[]> {
      const since = new Date(Date.parse(deps.asOf ?? new Date().toISOString()) - 30 * 86_400_000).toISOString();
      const { data, error } = await deps.db.from("credit_events")
        .select("event_type, severity, scope, title, payload, created_at")
        .in("scope", ["country", "currency", "industry"])
        .eq("is_demo", deps.isDemo ?? false)
        .is("archived_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error || !data) return [];
      const out: MacroContextEvent[] = [];
      const seen = new Set<string>();
      for (const e of data as { event_type: string; severity: MacroContextEvent["severity"]; scope: string; title: string; payload: Record<string, unknown> }[]) {
        const p = e.payload ?? {};
        let key: string | undefined, agent: MacroContextEvent["source_agent"] | undefined;
        if (e.scope === "country" && country && p.country_code === country) { key = country; agent = "country_risk_agent"; }
        else if (e.scope === "currency" && currency && p.currency_code === currency) { key = currency; agent = "fx_risk_agent"; }
        else if (e.scope === "industry" && sector && p.sector === sector) { key = sector; agent = "industry_risk_agent"; }
        if (!key || !agent) continue;
        const dedupe = `${agent}|${e.event_type}|${key}`;
        if (seen.has(dedupe)) continue;      // newest of each kind only
        seen.add(dedupe);
        out.push({ source_agent: agent, event_type: e.event_type, severity: e.severity, key, title: e.title });
      }
      return out;
    },
  };

  // ─── Source helpers ─────────────────────────────────────────────────────────

  async function companiesHouse(app: CreditApplication): Promise<RegistryRecord> {
    const key = deps.env("COMPANIES_HOUSE_API_KEY");
    if (!key) return { source: "companies_house", found: false, unavailable: true, unavailable_reason: "no_api_key" };
    const auth = { headers: { Authorization: `Basic ${btoa(`${key}:`)}` } };
    const base = "https://api.company-information.service.gov.uk";
    let number = app.registration_no?.replace(/\s+/g, "").toUpperCase();
    if (!number) {
      const search = await getJson<{ items?: { company_number: string; title: string }[] }>(
        `${base}/search/companies?q=${encodeURIComponent(app.legal_name)}&items_per_page=5`, auth);
      if (search === null) return { source: "companies_house", found: false, unavailable: true, unavailable_reason: "search_failed" };
      const want = simpleName(app.legal_name);
      number = search.items?.find((i) => simpleName(i.title) === want)?.company_number;
      if (!number) return { source: "companies_house", found: false };
    }
    let profileRes: Response;
    try { profileRes = await get(`${base}/company/${number}`, auth); }
    catch (e) { return { source: "companies_house", found: false, unavailable: true, unavailable_reason: (e as Error).name === "AbortError" ? "timeout" : "network" }; }
    if (profileRes.status === 404) return { source: "companies_house", found: false, registration_no: number };
    if (!profileRes.ok) return { source: "companies_house", found: false, unavailable: true, unavailable_reason: `http_${profileRes.status}` };
    const profile = await profileRes.json() as { company_name: string; company_status?: string; date_of_creation?: string };
    const officers = await getJson<{ items?: { name: string; officer_role: string; resigned_on?: string; nationality?: string }[] }>(
      `${base}/company/${number}/officers?items_per_page=100`, auth);
    const psc = await getJson<{ items?: { name?: string; name_elements?: { forename?: string; middle_name?: string; surname?: string }; kind: string; ceased_on?: string; natures_of_control?: string[]; country_of_residence?: string }[] }>(
      `${base}/company/${number}/persons-with-significant-control?items_per_page=100`, auth);
    const status = profile.company_status === "active" ? "active" : profile.company_status === "dormant" ? "dormant" : "dissolved";
    return {
      source: "companies_house", found: true, status, registration_no: number,
      legal_name: profile.company_name, formation_date: profile.date_of_creation,
      officers: (officers?.items ?? []).filter((o) => !o.resigned_on).map((o): Person => ({
        name: chName(o.name), role: o.officer_role.includes("director") ? "director" : "officer",
      })),
      owners: (psc?.items ?? []).filter((p) => !p.ceased_on && p.name && p.kind.startsWith("individual")).map((p): Person => ({
        name: pscName(p.name!, p.name_elements), role: "owner", ownership_pct: pscPct(p.natures_of_control ?? []),
      })),
    };
  }

  async function secRegistry(app: CreditApplication): Promise<RegistryRecord | null> {
    const cik = app.cik ?? (app.ticker ? await tickerToCik(app.ticker) : undefined);
    if (!cik) return null;
    const sub = await getJson<{ name: string; formerNames?: unknown[] }>(
      `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } });
    if (!sub) return null;
    return { source: "sec_edgar", found: true, status: "active", legal_name: sub.name, registration_no: cik };
  }

  async function gleif(app: CreditApplication): Promise<RegistryRecord> {
    const cc = app.country_code?.toUpperCase();
    const q = new URLSearchParams({ "filter[entity.legalName]": app.legal_name, "page[size]": "5" });
    if (cc) q.set("filter[entity.legalAddress.country]", cc);
    const r = await getJson<{ data?: { attributes: { lei: string; entity: { legalName: { name: string }; status: string; creationDate?: string; registeredAs?: string } } }[] }>(
      `https://api.gleif.org/api/v1/lei-records?${q}`);
    const hit = r?.data?.find((d) => simpleName(d.attributes.entity.legalName.name) === simpleName(app.legal_name));
    // Most small companies have no LEI, so "not in GLEIF" is a gap, not a fraud signal.
    if (!hit) return { source: "gleif", found: false, unavailable: true, unavailable_reason: r === null ? "gleif_unreachable" : "no_lei" };
    const e = hit.attributes.entity;
    return {
      source: "gleif", found: true, status: e.status === "ACTIVE" ? "active" : "dissolved",
      legal_name: e.legalName.name, formation_date: e.creationDate?.slice(0, 10), registration_no: e.registeredAs,
    };
  }

  async function vies(countryCode: string, taxId: string): Promise<TaxIdCheck | null> {
    const vatNumber = taxId.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(EL|GR|[A-Z]{2})/, "");
    try {
      const r = await get("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryCode, vatNumber }),
      });
      if (!r.ok) return null;
      const j = await r.json() as { valid?: boolean; name?: string; userError?: string };
      if (j.userError && j.userError !== "VALID" && j.userError !== "INVALID") return null;   // member state down: gap, not a flag
      return { source: "vies", valid: !!j.valid, registered_name: j.name && j.name !== "---" ? j.name : undefined };
    } catch { return null; }
  }

  async function hmrcVat(taxId: string): Promise<TaxIdCheck | null> {
    const id = deps.env("HMRC_CLIENT_ID"), secret = deps.env("HMRC_CLIENT_SECRET");
    if (!id || !secret) return null;
    const vrn = taxId.toUpperCase().replace(/[^0-9]/g, "");
    try {
      const tok = await get("https://api.service.hmrc.gov.uk/oauth/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
      });
      if (!tok.ok) return null;
      const { access_token } = await tok.json() as { access_token: string };
      const r = await get(`https://api.service.hmrc.gov.uk/organisations/vat/check-vat-number/lookup/${vrn}`, {
        headers: { Authorization: `Bearer ${access_token}`, Accept: "application/vnd.hmrc.2.0+json" },
      });
      if (r.status === 404) return { source: "hmrc_vat", valid: false };
      if (!r.ok) return null;
      const j = await r.json() as { target?: { name?: string } };
      return { source: "hmrc_vat", valid: true, registered_name: j.target?.name };
    } catch { return null; }
  }

  async function tickerToCik(ticker: string): Promise<string | undefined> {
    const map = await getJson<Record<string, { cik_str: number; ticker: string }>>(
      "https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } });
    const hit = map && Object.values(map).find((v) => v.ticker.toUpperCase() === ticker.toUpperCase());
    return hit ? String(hit.cik_str) : undefined;
  }

  async function edgarFinancials(cik: string): Promise<FinancialStatement | null> {
    type Fact = { end: string; val: number; form: string; fp?: string; fy?: number; filed: string };
    const facts = await getJson<{ facts?: { "us-gaap"?: Record<string, { units?: Record<string, Fact[]> }> } }>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } });
    const gaap = facts?.facts?.["us-gaap"];
    if (!gaap) return null;
    const annual = (concept: string) => (gaap[concept]?.units?.USD ?? []).filter((x) => x.form === "10-K" && x.fp === "FY");
    const periodEnd = annual("Assets").map((x) => x.end).sort().at(-1);
    if (!periodEnd) return null;
    const val = (...concepts: string[]) => {
      for (const c of concepts) {
        const hit = annual(c).filter((x) => x.end === periodEnd).sort((a, b) => b.filed.localeCompare(a.filed))[0];
        if (hit) return hit.val;
      }
      return undefined;
    };
    return {
      period_end: periodEnd, statement_quality: "audited", currency: "USD",
      revenue: val("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"),
      net_income: val("NetIncomeLoss"),
      total_assets: val("Assets"), total_liabilities: val("Liabilities"),
      current_assets: val("AssetsCurrent"), current_liabilities: val("LiabilitiesCurrent"),
      equity: val("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
      cash: val("CashAndCashEquivalentsAtCarryingValue"),
    };
  }

  async function fmpFinancials(ticker: string, key: string): Promise<FinancialStatement | null> {
    const q = `symbol=${encodeURIComponent(ticker)}&limit=1&apikey=${key}`;
    const bs = await getJson<Record<string, number | string>[]>(`https://financialmodelingprep.com/stable/balance-sheet-statement?${q}`);
    const is = await getJson<Record<string, number | string>[]>(`https://financialmodelingprep.com/stable/income-statement?${q}`);
    const b = bs?.[0];
    if (!b) return null;
    const i = is?.[0] ?? {};
    const n = (x: unknown) => (typeof x === "number" ? x : undefined);
    return {
      period_end: String(b.date), statement_quality: "audited", currency: String(b.reportedCurrency ?? "USD"),
      revenue: n(i.revenue), net_income: n(i.netIncome), ebitda: n(i.ebitda),
      total_assets: n(b.totalAssets), total_liabilities: n(b.totalLiabilities),
      current_assets: n(b.totalCurrentAssets), current_liabilities: n(b.totalCurrentLiabilities),
      equity: n(b.totalStockholdersEquity), cash: n(b.cashAndCashEquivalents),
    };
  }

  async function fileScore(base: string, key: string, app: CreditApplication, financials: FinancialStatement[]): Promise<ScoreResult | ProviderError> {
    const body = {
      request_id: app.application_id,
      company: {
        legal_name: app.legal_name, country_code: app.country_code, registration_no: app.registration_no,
        tax_id: app.tax_id, duns: app.duns, website: app.website,
      },
      financials,
      requested_limit: app.credit_request.amount_usd,
      currency: app.credit_request.invoicing_currency ?? "USD",
    };
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    let r: Response;
    try { r = await get(`${base}/v1/score`, { method: "POST", headers, body: JSON.stringify(body) }); }
    catch (e) { return { error: (e as Error).name === "AbortError" ? "timeout" : "unavailable" }; }
    if (r.status === 202) {
      const { job_id } = await r.json() as { job_id: string };
      for (let i = 0; i < 5; i++) {
        await new Promise((res) => setTimeout(res, 2_000));
        try { r = await get(`${base}/v1/score/${job_id}`, { headers }); } catch { return { error: "timeout" }; }
        if (r.status !== 202) break;
      }
      if (r.status === 202) return { error: "timeout" };
    }
    if (r.status === 422) return { error: "insufficient_data" };
    if (!r.ok) return { error: "unavailable" };
    const j = await r.json() as { score: number; model_version?: string; recommended_limit?: number; reason_codes?: { code: string }[] };
    if (typeof j.score !== "number") return { error: "unavailable" };
    return {
      provider: "file", score: j.score, model_version: j.model_version,
      reason_codes: (j.reason_codes ?? []).map((c) => c.code),
      max_credit_recommendation_usd: j.recommended_limit,
    };
  }
}

// ─── Pure helpers (exported for tests) ─────────────────────────────────────────

export function normId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Companies House lists people as "SURNAME, Forenames"; turn that into "Forenames Surname". */
export function chName(name: string): string {
  const [last, first] = name.split(",").map((s) => s.trim());
  if (!first) return titleCase(last);
  return `${titleCase(first)} ${titleCase(last)}`;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

/** PSC names carry titles ("Mr Alistair Munro"); prefer the structured parts. */
export function pscName(name: string, el?: { forename?: string; middle_name?: string; surname?: string }): string {
  if (el?.surname) return titleCase([el.forename, el.middle_name, el.surname].filter(Boolean).join(" "));
  return name.replace(/^(mr|mrs|ms|miss|mx|dr|sir|dame|lord|lady|prof)\.?\s+/i, "").trim();
}

/** Lower bound of the PSC ownership band ("ownership-of-shares-25-to-50-percent" → 25). */
export function pscPct(natures: string[]): number | undefined {
  const m = natures.map((n) => n.match(/ownership-of-shares-(\d+)-to-\d+-percent|ownership-of-shares-more-than-(\d+)-percent/))
    .filter(Boolean).map((m) => Number(m![1] ?? m![2]));
  return m.length ? Math.max(...m) : undefined;
}

function simpleName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\b(LIMITED|LTD|PLC|LLC|INC|CORP|CORPORATION|GMBH|AG|SA|BV)\b/g, "").replace(/\s+/g, " ").trim();
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from), b = new Date(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
}
