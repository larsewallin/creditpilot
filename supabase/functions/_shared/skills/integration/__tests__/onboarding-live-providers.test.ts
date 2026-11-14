/**
 * Onboarding live adapters (_shared/onboarding/live_providers.ts) with a fake network: checks request shapes and how each
 * source's answers and failures are mapped, without calling anything real.
 */
import { describe, it, expect } from "vitest";
import { liveProviders, chName, pscName, pscPct, normId, recordFromCard, registerStatus } from "../../../onboarding/live_providers.ts";
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

describe("Company Lookup card", () => {
  const card = (o: Record<string, unknown> = {}) => ({
    id: "de:HRB-719915", as_of: "2026-11-13",
    identity: { legal_name: "SAP SE", country: "DE", status: "active", incorporated: "1972-04-01", register: { name: "Handelsregister", number: "HRB 719915" } },
    ids: { lei: "529900D6BF99LW9R2E68" }, flags: [], verdict: "clear",
    sources: [{ name: "GLEIF", result: "found" }], gaps: [], ...o,
  });
  const lookup = (c: unknown) => ({ card: async () => c as never });

  it("uses the card for a company picked in Company Lookup", async () => {
    let gleif = false;
    const f = fakeFetch([[/api\.gleif\.org/, () => { gleif = true; return ok({ data: [] }); }]]);
    const r = await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f, lookup: lookup(card()) })
      .lookupRegistry(app({ country_code: "DE", legal_name: "SAP SE", company_id: "de:HRB-719915" }));
    expect(gleif).toBe(false);
    expect(r).toMatchObject({ source: "company_lookup", found: true, status: "active", formation_date: "1972-04-01", registration_no: "HRB 719915" });
    expect(r.lookup?.verdict).toBe("clear");
  });
  it("falls back to the direct sources when the card cannot be read", async () => {
    const f = fakeFetch([[/api\.gleif\.org/, () => ok({ data: [] })]]);
    const r = await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f, lookup: lookup({ error: "unavailable" }) })
      .lookupRegistry(app({ country_code: "DE", legal_name: "Kleine GmbH", company_id: "de:HRB-1" }));
    expect(r.source).toBe("gleif");
  });
  it("keeps the UK officers and owners from Companies House", async () => {
    const f = fakeFetch([
      [/\/company\/08812345\/officers/, () => ok({ items: [{ name: "PRYCE, Gareth", officer_role: "director" }] })],
      [/\/company\/08812345\/persons-with-significant-control/, () => ok({ items: [] })],
      [/\/company\/08812345$/, () => ok({ company_name: "PINEWOOD TOOLING LTD", company_status: "active", date_of_creation: "2013-11-20" })],
    ]);
    const c = card({ id: "gb:08812345", identity: { legal_name: "PINEWOOD TOOLING LTD", status: "Active", register: { name: "Companies House", number: "08812345" } } });
    const r = await liveProviders({ db: fakeDb(), env: (k) => (k === "COMPANIES_HOUSE_API_KEY" ? "k" : undefined), fetch: f, lookup: lookup(c) })
      .lookupRegistry(app({ company_id: "gb:08812345" }));
    expect(r.source).toBe("company_lookup");
    expect(r.officers?.map((p) => p.name)).toEqual(["Gareth Pryce"]);
  });
  it("never reads an unclear status as active", () => {
    expect(registerStatus("Active")).toBe("active");
    expect(registerStatus("Dissolved")).toBe("dissolved");
    expect(registerStatus("in liquidation")).toBe("dissolved");
    expect(registerStatus("dormant")).toBe("dormant");
    expect(registerStatus("unknown")).toBe(undefined);
    expect(recordFromCard("x:1", card({ identity: {} }) as never).found).toBe(false);
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

describe("Keen adapter", () => {
  const env = (k: string) => ({ KEEN_API_URL: "https://keen.test/", KEEN_API_KEY: "k" } as Record<string, string>)[k];
  it("maps a score and the recommended limit", async () => {
    const f = fakeFetch([[/keen\.test\/v1\/score$/, () => ok({ score: 92, model_version: "m1", recommended_limit: 60_000, reason_codes: [{ code: "CURRENT_RATIO" }] })]]);
    const r = await liveProviders({ db: fakeDb(), env, fetch: f }).keenScore(app());
    expect(r).toMatchObject({ provider: "keen", score: 92, model_version: "m1", reason_codes: ["CURRENT_RATIO"], max_credit_recommendation_usd: 60_000 });
  });
  it("keeps Keen's label, 10-K date and reasons", async () => {
    const f = fakeFetch([[/keen\.test\/v1\/score$/, () => ok({
      score: 79, label: "Strong", model_version: "keen-r120", as_of: "2026-09-26",
      company: { ticker: "AAPL", name: "Apple Inc." }, filing: { form: "10-K", fiscal_year: 2026, filed: "2026-10-31" },
      reason_codes: [{ code: "STRONG_CURRENT_RATIO", text: "Current ratio 1.1x", direction: "positive" }], warnings: [],
    })]]);
    const r = await liveProviders({ db: fakeDb(), env, fetch: f }).keenScore(app({ ticker: "AAPL" }));
    expect(r).toMatchObject({ score: 79, keen: { label: "Strong", as_of: "2026-09-26", company_name: "Apple Inc.",
      filing: { form: "10-K", fiscal_year: 2026 }, reasons: [{ code: "STRONG_CURRENT_RATIO", text: "Current ratio 1.1x", direction: "positive" }] } });
  });
  it("finds the ticker from the SEC number when only a CIK is known", async () => {
    let sent: { company: Record<string, unknown> } | undefined;
    const f = fakeFetch([
      [/sec\.gov\/files\/company_tickers\.json/, () => ok({ 0: { cik_str: 320193, ticker: "AAPL" }, 1: { cik_str: 789019, ticker: "MSFT" } })],
      [/keen\.test\/v1\/score$/, (_u, init) => { sent = JSON.parse(String(init?.body)); return ok({ score: 79 }); }],
    ]);
    await liveProviders({ db: fakeDb(), env, fetch: f }).keenScore(app({ cik: "0000320193" }));
    expect(sent?.company.ticker).toBe("AAPL");
  });
  it("sends the ticker and CIK with a Bearer key (Keen API v1 scores public companies by ticker)", async () => {
    let sent: { auth?: string; body?: { company: Record<string, unknown> } } = {};
    const f = fakeFetch([[/keen\.test\/v1\/score$/, (_u, init) => {
      sent = { auth: (init?.headers as Record<string, string>)?.Authorization, body: JSON.parse(String(init?.body)) };
      return ok({ score: 70 });
    }]]);
    await liveProviders({ db: fakeDb(), env, fetch: f }).keenScore(app({ ticker: "AAPL", cik: "0000320193" }));
    expect(sent.auth).toBe("Bearer k");
    expect(sent.body?.company.ticker).toBe("AAPL");
    expect(sent.body?.company.cik).toBe("0000320193");
  });
  it("maps 422 to insufficient data and a missing config to unavailable", async () => {
    const f = fakeFetch([[/keen\.test/, () => new Response("", { status: 422 })]]);
    expect(await liveProviders({ db: fakeDb(), env, fetch: f }).keenScore(app())).toEqual({ error: "insufficient_data" });
    const g = fakeFetch([[/keen\.test/, () => ok({ error: "insufficient_data", reason: "foreign-filer" }, 422)]]);
    expect(await liveProviders({ db: fakeDb(), env, fetch: g }).keenScore(app({ ticker: "SAP" }))).toEqual({ error: "insufficient_data", reason: "foreign-filer" });
    expect(await liveProviders({ db: fakeDb(), env: () => undefined, fetch: f }).keenScore(app())).toEqual({ error: "unavailable" });
  });
  it("maps a slow answer to timeout", async () => {
    const slow: typeof fetch = ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => {
      init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as typeof fetch;
    expect(await liveProviders({ db: fakeDb(), env, fetch: slow, timeoutMs: 20 }).keenScore(app())).toEqual({ error: "timeout" });
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
