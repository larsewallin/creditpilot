import { describe, expect, it } from "vitest";
import { CATEGORIES, CONNECTORS, connectorStatuses } from "../../supabase/functions/_shared/connectors";

describe("connectors", () => {
  it("every connector belongs to a listed category and keys are unique", () => {
    const cats = new Set(CATEGORIES.map((c) => c.key));
    for (const c of CONNECTORS) expect(cats.has(c.category), c.key).toBe(true);
    expect(new Set(CONNECTORS.map((c) => c.key)).size).toBe(CONNECTORS.length);
  });
  it("status follows which settings are present, never their values", () => {
    const none = connectorStatuses(() => false);
    const by = (v: typeof none, k: string) => v.find((c) => c.key === k)!;
    expect(by(none, "keen").status).toBe("planned");   // paused (founder, 2026-11-18)
    expect(by(none, "company_lookup").status).toBe("default");
    expect(by(none, "sec_edgar").status).toBe("built_in");
    expect(by(none, "tavily").missing).toEqual(["TAVILY_API_KEY"]);
    const all = connectorStatuses(() => true);
    expect(by(all, "keen").status).toBe("planned");
    expect(by(all, "tavily").missing).toEqual([]);
  });
});
