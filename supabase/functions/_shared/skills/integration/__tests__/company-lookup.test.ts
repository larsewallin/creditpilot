import { describe, it, expect } from "vitest";
import { companyLookup, prefillFromCard, isCompanyId, cikFromCompanyId, type LookupCard } from "../../../onboarding/company_lookup";

const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const recorder = (respond: (url: string) => Response) => {
  const calls: string[] = [];
  const f = (async (u: RequestInfo | URL) => { calls.push(String(u)); return respond(String(u)); }) as typeof fetch;
  return { f, calls };
};

const CARD: LookupCard = {
  id: "gb:00445790",
  as_of: "2026-11-13",
  identity: {
    legal_name: "TESCO PLC", country: "GB", status: "Active", incorporated: "1947-11-27", incorporated_source: "Companies House",
    registered_address: "Tesco House, Shire Park, Kestrel Way, Welwyn Garden City, AL7 1GA",
    register: { name: "Companies House (UK)", number: "00445790" }, website: null,
  },
  ids: { lei: "2138002P5RNKC5W2JZ46", national: "00445790" },
  flags: [{ level: "info", label: "Listed company" }],
  verdict: "clear",
  sources: [{ name: "Companies House", result: "Found" }],
  gaps: [],
};

describe("Company Lookup connector", () => {
  it("searches the configured address and maps results", async () => {
    const { f, calls } = recorder(() => ok({ results: [{ id: "gb:00445790", name: "TESCO PLC", country: "GB", source: "Companies House", number: "00445790", status: "active" }], warnings: [] }));
    const r = await companyLookup({ baseUrl: "http://localhost:3000/", fetch: f }).search(" Tesco ", "gb");
    expect(calls[0]).toBe("http://localhost:3000/api/search?q=Tesco&country=GB");
    expect("results" in r && r.results[0]).toMatchObject({ id: "gb:00445790", name: "TESCO PLC", lei: null });
  });

  it("defaults to the hosted copy; short queries are refused without a call", async () => {
    const { f, calls } = recorder(() => ok({ results: [] }));
    const lookup = companyLookup({ fetch: f });
    expect(await lookup.search("T")).toEqual({ error: "bad_request", message: "Type at least 2 characters" });
    await lookup.search("Siemens");
    expect(calls).toEqual(["https://larsewallin.com/api/search?q=Siemens"]);
  });

  it("maps errors: 404, 502, network failure, timeout", async () => {
    expect(await companyLookup({ fetch: recorder(() => ok({ error: "No such company" }, 404)).f }).card("gb:99999999")).toEqual({ error: "not_found", message: "No such company" });
    expect(await companyLookup({ fetch: recorder(() => ok({ error: "down" }, 502)).f }).search("Tesco")).toEqual({ error: "unavailable", message: "down" });
    const boom = (async () => { throw new TypeError("network"); }) as typeof fetch;
    expect(await companyLookup({ fetch: boom }).search("Tesco")).toEqual({ error: "unavailable" });
    const slow = ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => {
      init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as typeof fetch;
    expect(await companyLookup({ fetch: slow, timeoutMs: 20 }).search("Tesco")).toEqual({ error: "timeout" });
  });

  it("only sends well-formed company ids", async () => {
    const { f, calls } = recorder(() => ok(CARD));
    expect(await companyLookup({ fetch: f }).card("../../etc")).toEqual({ error: "bad_request", message: "Not a Company Lookup id" });
    await companyLookup({ fetch: f }).card("gb:00445790", "tesco.com");
    expect(calls).toEqual(["https://larsewallin.com/api/company?id=gb%3A00445790&website=tesco.com"]);
    expect(isCompanyId("lei:2138002P5RNKC5W2JZ46")).toBe(true);
    expect(isCompanyId("us:sec-0000320193")).toBe(true);
    expect(isCompanyId("GB 00445790")).toBe(false);
  });
});

describe("prefillFromCard", () => {
  it("takes only stated facts, each with its source and date", () => {
    const p = prefillFromCard("gb:00445790", CARD);
    expect(p).toMatchObject({
      company_id: "gb:00445790", legal_name: "TESCO PLC", country_code: "GB", registration_no: "00445790",
      lei: "2138002P5RNKC5W2JZ46", date_established: "1947-11-27", verdict: "clear",
    });
    expect(p.website).toBeUndefined();
    expect(p.sources.find((s) => s.field === "registration_no")).toEqual({ field: "registration_no", source: "Companies House (UK)", checked: "2026-11-13" });
    expect(p.sources.find((s) => s.field === "lei")?.source).toBe("GLEIF");
  });

  it("a US SEC filer gets its CIK and is marked public, no registration number", () => {
    const p = prefillFromCard("us:sec-320193", { ...CARD, id: "us:sec-0000320193", identity: { legal_name: "Apple Inc.", country: "US", register: { name: "SEC EDGAR", number: "sec-0000320193" } } });
    expect(p.cik).toBe("0000320193");
    expect(p.is_public).toBe(true);
    expect(p.registration_no).toBeUndefined();
    expect(cikFromCompanyId("gb:00445790")).toBeNull();
  });
});
