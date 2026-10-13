/**
 * Onboarding live adapters (_shared/onboarding/live_providers.ts) with a fake network: checks request shapes and how each
 * source's answers and failures are mapped, without calling anything real.
 */
import { describe, it, expect } from "vitest";
import { liveProviders, chName, pscName, pscPct, normId } from "../../../onboarding/live_providers.ts";
import type { CreditApplication } from "../../../onboarding/types.ts";

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(routes: [RegExp, Route][]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const fakeDb = (tables: Record<string, unknown[]> = {}, rpc: Record<string, unknown[]> = {}) => {
  const q = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "gte", "order", "limit", "like"]) chain[m] = () => chain;
    (chain as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
    return chain;
  };
  return {
    from: (t: string) => q(tables[t] ?? []),
    rpc: async (fn: string) => ({ data: rpc[fn] ?? [], error: null }),
  } as never;
};

const app = (o: Partial<CreditApplication> = {}): CreditApplication => ({
  application_id: "A1", submitted_by: "credit_team", legal_name: "Pinewood Tooling Ltd", country_code: "GB",
  people: [], credit_request: { amount_usd: 100_000 }, trade_references: [], financial_statements: [], signatures: {}, ...o,
});

describe("helpers", () => {
  it("turns Companies House names into normal order", () => {
    expect(chName("PRYCE, Gareth John")).toBe("Gareth John Pryce");
    expect(chName("O'NEILL-SMITH, mary")).toBe("Mary O'Neill-Smith");
  });
  it("drops titles from PSC names", () => {
    expect(pscName("Mr Alistair Munro")).toBe("Alistair Munro");
    expect(pscName("Mrs J Smith", { forename: "JANE", surname: "SMITH" })).toBe("Jane Smith");
  });
  it("reads the PSC ownership band", () => {
    expect(pscPct(["ownership-of-shares-25-to-50-percent", "voting-rights-25-to-50-percent"])).toBe(25);
    expect(pscPct(["ownership-of-shares-75-to-100-percent"])).toBe(75);
    expect(pscPct(["significant-influence-or-control"])).toBe(undefined);
  });
  it("normalizes identifiers", () => {
    expect(normId("gb 284 519-377")).toBe("GB284519377");
  });
});

describe("Companies House", () => {
  const env = (k: string) => (k === "COMPANIES_HOUSE_API_KEY" ? "test-key" : undefined);
  it("maps profile, active officers and individual PSCs, with basic auth", async () => {
    let auth = "";
    const f = fakeFetch([
      [/\/company\/08812345\/officers/, () => ok({ items: [
        { name: "PRYCE, Gareth", officer_role: "director" },
        { name: "DOYLE, Siobhan", officer_role: "director" },
        { name: "OLDHAM, Ken", officer_role: "secretary", resigned_on: "2020-01-01" }] })],
      [/\/company\/08812345\/persons-with-significant-control/, () => ok({ items: [
        { name: "Mr Alistair Munro", kind: "individual-person-with-significant-control", natures_of_control: ["ownership-of-shares-25-to-50-percent"] },
        { name: "Holdco Ltd", kind: "corporate-entity-person-with-significant-control" }] })],
      [/\/company\/08812345$/, (_u, init) => { auth = String((init?.headers as Record<string, string>).Authorization); return ok({ company_name: "PINEWOOD TOOLING LTD", company_status: "active", date_of_creation: "2013-11-20" }); }],
    ]);
    const r = await liveProviders({ db: fakeDb(), env, fetch: f }).lookupRegistry(app({ registration_no: "08812345" }));
    expect(auth).toBe(`Basic ${btoa("test-key:")}`);
    expect(r.found).toBe(true);
    expect(r.formation_date).toBe("2013-11-20");
    expect(r.officers?.map((p) => p.name)).toEqual(["Gareth Pryce", "Siobhan Doyle"]);
    expect(r.owners?.map((p) => p.name)).toEqual(["Alistair Munro"]);
  });
  it("reports not found on 404, and a gap (not a flag) when the key is missing", async () => {
    const f = fakeFetch([[/\/company\//, () => new Response("", { status: 404 })]]);
    const nf = await liveProviders({ db: fakeDb(), env, fetch: f }).lookupRegistry(app({ registration_no: "00000001" }));
    expect(nf.found).toBe(false);
    expect(nf.unavailable).toBe(undefined);
    const nokey = await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f }).lookupRegistry(app());
    expect(nokey.unavailable).toBe(true);
    expect(nokey.unavailable_reason).toBe("no_api_key");
  });
});

describe("existing customer", () => {
  it("ignores the application's own prospect", async () => {
    const rows = [{ customer_id: "own", customers: { company_name: "Apple Inc." } }];
    const p = (exclude?: string) => liveProviders({ db: fakeDb({ customer_identifiers: rows }), env: () => undefined, excludeCustomerId: exclude });
    expect(await p("own").findExistingCustomer(app({ tax_id: "94-2404110" }))).toBe(null);
    expect((await p("other").findExistingCustomer(app({ tax_id: "94-2404110" })))?.customer_id).toBe("own");
  });
});

describe("GLEIF", () => {
  it("treats absence as a gap, not a fraud signal", async () => {
    const f = fakeFetch([[/api\.gleif\.org/, () => ok({ data: [] })]]);
    const r = await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f }).lookupRegistry(app({ country_code: "DE", legal_name: "Kleine GmbH" }));
    expect(r.unavailable).toBe(true);
  });
});

describe("tax IDs", () => {
  it("checks EU VAT with VIES and strips the country prefix", async () => {
    let sent = "";
    const f = fakeFetch([[/vies\/rest-api\/check-vat-number/, (_u, init) => { sent = String(init?.body); return ok({ valid: true, name: "RHEINFELD SPEZIALCHEMIE GMBH" }); }]]);
    const r = await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f }).checkTaxId(app({ country_code: "DE", tax_id: "DE298114562" }));
    expect(JSON.parse(sent)).toEqual({ countryCode: "DE", vatNumber: "298114562" });
    expect(r).toEqual({ source: "vies", valid: true, registered_name: "RHEINFELD SPEZIALCHEMIE GMBH" });
  });
  it("returns no check (not invalid) when a member state service is down", async () => {
    const f = fakeFetch([[/vies/, () => ok({ valid: false, userError: "MS_UNAVAILABLE" })]]);
    expect(await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f }).checkTaxId(app({ country_code: "FR", tax_id: "FR12345678901" }))).toBe(null);
  });
  it("only format-checks US EINs", async () => {
    const p = liveProviders({ db: fakeDb(), env: () => undefined, fetch: fakeFetch([]) });
    expect((await p.checkTaxId(app({ country_code: "US", tax_id: "31-4482910" })))?.valid).toBe(true);
    expect((await p.checkTaxId(app({ country_code: "US", tax_id: "3144829" })))?.valid).toBe(false);
  });
});

describe("domain age", () => {
  it("reads the RDAP registration event", async () => {
    const f = fakeFetch([[/rdap\.org\/domain\/example\.org/, () => ok({ events: [{ eventAction: "registration", eventDate: "2026-08-01T00:00:00Z" }] })]]);
    const p = liveProviders({ db: fakeDb(), env: () => undefined, fetch: f, asOf: "2026-10-13" });
    expect(await p.domainAgeMonths("https://www.example.org/about")).toBe(2);
  });
});

describe("SEC EDGAR financials", () => {
  it("takes the latest 10-K annual values", async () => {
    const fact = (end: string, val: number) => ({ end, val, form: "10-K", fp: "FY", filed: end });
    const f = fakeFetch([[/companyfacts\/CIK0001999001/, () => ok({ facts: { "us-gaap": {
      Assets: { units: { USD: [fact("2024-12-31", 170), fact("2025-12-31", 180)] } },
      AssetsCurrent: { units: { USD: [fact("2025-12-31", 80)] } },
      LiabilitiesCurrent: { units: { USD: [fact("2025-12-31", 40)] } },
      StockholdersEquity: { units: { USD: [fact("2025-12-31", 90)] } },
    } } })]]);
    const r = await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f }).publicFinancials(app({ is_public: true, cik: "0001999001", country_code: "US" }));
    expect(Array.isArray(r) && r[0]).toMatchObject({ period_end: "2025-12-31", total_assets: 180, current_assets: 80, equity: 90, statement_quality: "audited" });
  });
});

describe("File adapter", () => {
  const env = (k: string) => ({ FILE_API_URL: "https://file.test/", FILE_API_KEY: "k" } as Record<string, string>)[k];
  it("maps a score and the recommended limit", async () => {
    const f = fakeFetch([[/file\.test\/v1\/score$/, () => ok({ score: 92, model_version: "m1", recommended_limit: 60_000, reason_codes: [{ code: "CURRENT_RATIO" }] })]]);
    const r = await liveProviders({ db: fakeDb(), env, fetch: f }).fileScore(app());
    expect(r).toEqual({ provider: "file", score: 92, model_version: "m1", reason_codes: ["CURRENT_RATIO"], max_credit_recommendation_usd: 60_000 });
  });
  it("maps 422 to insufficient data and a missing config to unavailable", async () => {
    const f = fakeFetch([[/file\.test/, () => new Response("", { status: 422 })]]);
    expect(await liveProviders({ db: fakeDb(), env, fetch: f }).fileScore(app())).toEqual({ error: "insufficient_data" });
    expect(await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f }).fileScore(app())).toEqual({ error: "unavailable" });
  });
  it("maps a slow answer to timeout", async () => {
    const slow: typeof fetch = ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => {
      init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as typeof fetch;
    expect(await liveProviders({ db: fakeDb(), env, fetch: slow, timeoutMs: 20 }).fileScore(app())).toEqual({ error: "timeout" });
  });
});

describe("sanctions (fail closed)", () => {
  const fresh = ["OFAC_SDN", "OFAC_CONS", "EU", "UK", "UN"].map((list) => ({ list, last_success_at: "2026-10-13T02:00:00Z" }));
  it("refuses to screen when a list was never loaded or is stale", async () => {
    const missing = liveProviders({ db: fakeDb({ sanctions_list_status: fresh.slice(1) }), env: () => undefined, asOf: "2026-10-13T12:00:00Z" });
    await expect(missing.sanctionsList(["x"])).rejects.toThrow(/OFAC_SDN has never been loaded/);
    const stale = liveProviders({ db: fakeDb({ sanctions_list_status: fresh }), env: () => undefined, asOf: "2026-10-20T12:00:00Z" });
    await expect(stale.sanctionsList(["x"])).rejects.toThrow(/older than 3 days/);
  });
  it("maps candidate rows when lists are fresh", async () => {
    const p = liveProviders({ db: fakeDb({ sanctions_list_status: fresh }, { fn_sanctions_candidates: [
      { list: "UK", list_id: "RUS1234", entry_type: "person", name: "Dmitri Andreevich Volkhovsky", aliases: ["Dmitriy Volkhovskiy"], country_code: "RU", date_of_birth: null }] }),
      env: () => undefined, asOf: "2026-10-13T12:00:00Z" });
    expect(await p.sanctionsList(["Dmitry Volkhovsky"])).toEqual([{ list: "UK", list_id: "RUS1234", type: "person", name: "Dmitri Andreevich Volkhovsky",
      aliases: ["Dmitriy Volkhovskiy"], country_code: "RU", date_of_birth: undefined }]);
  });
});

describe("macro context", () => {
  it("keeps the newest event per agent, type and key that matches the prospect", async () => {
    const ev = (scope: string, payload: Record<string, unknown>, event_type = "X", title = "t") => ({ event_type, severity: "high", scope, title, payload });
    const p = liveProviders({ db: fakeDb({ credit_events: [
      ev("country", { country_code: "DE" }, "COUNTRY_RATING_CHANGE", "newest"),
      ev("country", { country_code: "DE" }, "COUNTRY_RATING_CHANGE", "older"),
      ev("country", { country_code: "FR" }),
      ev("currency", { currency_code: "EUR" }, "CURRENCY_VOLATILITY"),
      ev("industry", { sector: "Energy" }, "INDUSTRY_DOWNTURN"),
    ] }), env: () => undefined });
    const r = await p.macroContext("DE", "Chemicals", "EUR");
    expect(r.map((e) => `${e.source_agent}:${e.key}:${e.title}`)).toEqual(["country_risk_agent:DE:newest", "fx_risk_agent:EUR:t"]);
  });
});
