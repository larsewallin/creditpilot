import { describe, expect, it } from "vitest";
import { DEMO_PERSONAS, personaOf } from "../../supabase/functions/_shared/demo_personas";

describe("demo personas", () => {
  it("knows the three demo personas, all on example.com", () => {
    expect(Object.keys(DEMO_PERSONAS).sort()).toEqual(["credit_analyst", "credit_manager", "sales"]);
    for (const p of Object.values(DEMO_PERSONAS)) expect(p.email.endsWith("@demo.example.com")).toBe(true);
  });
  it("refuses anything else, including admin and prototype keys", () => {
    for (const bad of ["admin", "viewer", "toString", "__proto__", "", null, 1]) expect(personaOf(bad)).toBeNull();
    expect(personaOf("sales")?.role).toBe("sales");
  });
});
