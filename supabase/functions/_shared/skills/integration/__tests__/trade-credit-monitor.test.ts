import { describe, it, expect } from "vitest";
import { TradeCreditMonitorProvider, countrySignals, simpleName, tcmBase, tradeCreditMonitor, type TcmArticle } from "../trade-credit-monitor.ts";

const art = (o: Partial<TcmArticle>): TcmArticle => ({
  id: "1", title: "", url: "https://example.com/a", source: "Reuters", sourceKind: "news", feed: "gdelt", publishedAt: "2026-11-13T10:00:00Z",
  categories: ["insolvency"], primaryCategory: "insolvency", countries: ["GB"], sectors: [], companies: [], severity: 4, relevance: 0.8, ...o,
});
const fakeFetch = (articles: TcmArticle[], seen: string[] = []) => (async (u: RequestInfo | URL) => {
  seen.push(String(u));
  return new Response(JSON.stringify({ articles }), { status: 200 });
}) as typeof fetch;

describe("settings", () => {
  it("hosted copy by default; a local copy; off", () => {
    expect(tcmBase(() => undefined)).toBe("https://trade-credit-monitor.vercel.app");
    expect(tcmBase((k) => (k === "TCM_API_URL" ? "http://localhost:3000/" : undefined))).toBe("http://localhost:3000");
    expect(tcmBase(() => "off")).toBeNull();
  });
  it("names compare without punctuation and legal suffixes", () => {
    expect(simpleName("Pinewood Tooling Ltd.")).toBe(simpleName("PINEWOOD TOOLING LIMITED"));
  });
});

describe("news provider", () => {
  it("keeps stories naming the customer, never a shared word", async () => {
    const seen: string[] = [];
    const p = new TradeCreditMonitorProvider("https://tcm.test", { fetch: fakeFetch([
      art({ id: "1", title: "Pinewood Tooling enters administration", companies: ["Pinewood Tooling Ltd"] }),
      art({ id: "2", title: "Administrators appointed at PINEWOOD TOOLING LIMITED", feed: "gazette", sourceKind: "official" }),
      art({ id: "3", title: "Pinewood Studios results", companies: ["Pinewood Group"] }),
    ], seen) });
    const r = await p.search("Pinewood Tooling Ltd", undefined, 7, 10);
    expect(r.map((a) => a.headline)).toEqual(["Pinewood Tooling enters administration", "Administrators appointed at PINEWOOD TOOLING LIMITED"]);
    expect(r[0]).toMatchObject({ provider: "trade_credit_monitor", url: "https://example.com/a", relevance_score: 0.8 });
    expect(seen[0]).toContain("hours=168");
  });
  it("a failure is no stories", async () => {
    const c = tradeCreditMonitor("https://tcm.test", { fetch: (async () => { throw new Error("down"); }) as typeof fetch });
    expect(await c.news({ country: "GB" })).toEqual([]);
  });
});

describe("country signals", () => {
  it("the strongest story per type; economic wording is an economic shock", () => {
    const s = countrySignals("AR", [
      art({ id: "a", countries: ["AR"], severity: 4, title: "Argentina peso devaluation deepens" }),
      art({ id: "b", countries: ["AR"], severity: 5, title: "Argentina imposes new capital controls" }),
      art({ id: "c", countries: ["AR"], severity: 3, title: "Argentina election polls" }),
      art({ id: "d", countries: ["BR"], severity: 5, title: "Brazil sanctions" }),
    ]);
    expect(s.map((x) => [x.event_type, x.kind, x.severity, x.article.id])).toEqual([
      ["COUNTRY_ECONOMIC_SHOCK", "currency_crisis", "medium", "a"],
      ["COUNTRY_POLITICAL_RISK", "capital_controls", "high", "b"],
    ]);
  });
});
