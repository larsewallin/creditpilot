/**
 * Company Lookup connector (github.com/larsewallin/company-lookup, MIT).
 *
 * Searches official company registers, GLEIF, Wikidata, VIES and domain records
 * through the Company Lookup HTTP API and returns one company card. Every fact
 * on a card carries its source and the date it was checked.
 *
 * COMPANY_LOOKUP_URL sets the API's address (default: the hosted copy at
 * https://larsewallin.com; a local copy runs with `node server.js`, port 3000).
 *
 * The company ID is the card's own id, built from an official number:
 *   gb:00445790        national register number (country + number)
 *   us:sec-0000320193  SEC CIK
 *   lei:5493…          global LEI register
 * It is the same in CreditPilot, Company Lookup and (from Keen API v2) Keen.
 */

export const DEFAULT_COMPANY_LOOKUP_URL = "https://larsewallin.com";

export interface LookupResult {
  id: string;
  name: string;
  country: string | null;
  source: string;
  number?: string | null;
  status?: string | null;
  city?: string | null;
  incorporated?: string | null;
  lei?: string | null;
}

export interface LookupCard {
  id?: string;
  as_of: string;
  identity: {
    legal_name?: string | null;
    country?: string | null;
    legal_form?: string | null;
    status?: string | null;
    incorporated?: string | null;
    incorporated_source?: string | null;
    registered_address?: string | null;
    website?: string | null;
    vat?: string | null;
    register?: { name: string; number: string; url?: string } | null;
    sic_codes?: string[];
    industry?: string[];
  };
  ids?: { lei?: string | null; national?: string | null };
  web?: { domain?: string; registered?: string | null; age?: string | null } | null;
  flags: { level: "stop" | "check" | "info" | string; label: string; detail?: string; source?: string }[];
  verdict: "stop" | "check" | "clear";
  sources: { name: string; result: string; url?: string }[];
  gaps: string[];
}

export type LookupError = { error: "unavailable" | "timeout" | "not_found" | "bad_request"; message?: string };

export interface LookupDeps {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function companyLookup(deps: LookupDeps = {}) {
  const base = (deps.baseUrl || DEFAULT_COMPANY_LOOKUP_URL).replace(/\/$/, "");
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 20_000;

  async function get<T>(path: string): Promise<T | LookupError> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let r: Response;
    try {
      r = await doFetch(`${base}${path}`, { headers: { accept: "application/json" }, signal: ctrl.signal });
    } catch (e) {
      return { error: (e as Error).name === "AbortError" ? "timeout" : "unavailable" };
    } finally {
      clearTimeout(t);
    }
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (r.status === 404) return { error: "not_found", message: String(body.error ?? "") || undefined };
    if (r.status === 400) return { error: "bad_request", message: String(body.error ?? "") || undefined };
    if (!r.ok) return { error: "unavailable", message: String(body.error ?? "") || undefined };
    return body as T;
  }

  return {
    async search(q: string, country?: string): Promise<{ results: LookupResult[]; warnings: string[] } | LookupError> {
      const query = q.trim();
      if (query.length < 2) return { error: "bad_request", message: "Type at least 2 characters" };
      const params = new URLSearchParams({ q: query.slice(0, 120) });
      if (country && /^[A-Za-z]{2}$/.test(country)) params.set("country", country.toUpperCase());
      const r = await get<{ results?: LookupResult[]; warnings?: string[] }>(`/api/search?${params}`);
      if ("error" in r) return r;
      return {
        results: (r.results ?? []).map((x) => ({ id: x.id, name: x.name, country: x.country ?? null, source: x.source, number: x.number ?? null,
          status: x.status ?? null, city: x.city ?? null, incorporated: x.incorporated ?? null, lei: x.lei ?? null })),
        warnings: r.warnings ?? [],
      };
    },
    async card(id: string, website?: string): Promise<LookupCard | LookupError> {
      if (!isCompanyId(id)) return { error: "bad_request", message: "Not a Company Lookup id" };
      const params = new URLSearchParams({ id });
      if (website) params.set("website", website);
      return get<LookupCard>(`/api/company?${params}`);
    },
  };
}

/** gb:00445790, us:sec-0000320193, lei:5493…: a country or "lei", a colon, the number. */
export function isCompanyId(id: unknown): id is string {
  return typeof id === "string" && /^([a-z]{2}|lei):[A-Za-z0-9._\-/]{1,40}$/.test(id);
}

/** CIK from a US SEC company id (us:sec-0000320193 → 0000320193). */
export function cikFromCompanyId(id: string): string | null {
  const m = /^us:sec-(\d{1,10})$/.exec(id);
  return m ? m[1].padStart(10, "0") : null;
}

export interface Prefill {
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
  /** what came from where, for the form ("from Companies House, checked 2026-11-13") */
  sources: { field: string; source: string; checked: string }[];
  verdict: LookupCard["verdict"];
  flags: LookupCard["flags"];
}

/** Fields an application can take from a card. Only facts the card states; nothing guessed. */
export function prefillFromCard(id: string, card: LookupCard): Prefill {
  const idn = card.identity ?? {};
  const checked = card.as_of;
  const register = idn.register?.name ?? idn.incorporated_source ?? "the company register";
  const out: Prefill = { company_id: card.id ?? id, sources: [], verdict: card.verdict, flags: card.flags ?? [] };
  const put = <K extends keyof Prefill>(field: K, value: Prefill[K] | null | undefined, source: string) => {
    if (value === null || value === undefined || value === "") return;
    out[field] = value;
    out.sources.push({ field: String(field), source, checked });
  };
  put("legal_name", idn.legal_name, register);
  put("country_code", idn.country ? idn.country.toUpperCase() : null, register);
  const cik = cikFromCompanyId(out.company_id);
  if (cik) {
    put("cik", cik, "SEC EDGAR");
    put("is_public", true, "SEC EDGAR");
  } else {
    put("registration_no", idn.register?.number ?? card.ids?.national ?? null, register);
  }
  put("lei", card.ids?.lei ?? null, "GLEIF");
  put("website", idn.website ?? null, register);
  put("date_established", idn.incorporated ?? null, idn.incorporated_source ?? register);
  put("registered_address", idn.registered_address ?? null, register);
  return out;
}
