import { describe, expect, it } from "vitest";
import { POLICY_DEFAULTS, POLICY_GROUP_DEFAULTS } from "../../supabase/functions/_shared/policy/defaults";
import { ONBOARDING_DEFAULTS } from "../../supabase/functions/_shared/onboarding/settings";
import { FIELD_INFO, POLICY_SECTIONS, flatten, fromShown, toShown, unflatten } from "./policyFields";

const sectionValue = (key: string): unknown => {
  const [ns, s] = key.split(".");
  return ns === "policy" ? (POLICY_DEFAULTS as Record<string, unknown>)[s] : (ONBOARDING_DEFAULTS as unknown as Record<string, unknown>)[s];
};

describe("policy field labels", () => {
  it("label every rule the engine has, in every section shown", () => {
    const missing: string[] = [];
    for (const s of POLICY_SECTIONS) for (const [path] of flatten(sectionValue(s.key))) if (!FIELD_INFO[`${s.key}:${path}`]) missing.push(`${s.key}:${path}`);
    expect(missing).toEqual([]);
  });

  it("show every policy section", () => {
    const shown = POLICY_SECTIONS.map((s) => s.key);
    for (const s of Object.keys(POLICY_DEFAULTS)) expect(shown).toContain(`policy.${s}`);
  });

  it("label no rule the engine does not have", () => {
    const known = new Set(POLICY_SECTIONS.flatMap((s) => flatten(sectionValue(s.key)).map(([p]) => `${s.key}:${p}`)));
    expect(Object.keys(FIELD_INFO).filter((k) => !known.has(k))).toEqual([]);
  });

  it("starter groups only override labelled rules", () => {
    for (const g of Object.values(POLICY_GROUP_DEFAULTS)) for (const [s, v] of Object.entries(g.overrides))
      for (const [path] of flatten(v)) expect(FIELD_INFO[`policy.${s}:${path}`]).toBeDefined();
  });
});

describe("flatten / unflatten", () => {
  it("round-trip a nested section", () => {
    const v = ONBOARDING_DEFAULTS.template;
    expect(unflatten(flatten(v))).toEqual(v);
  });
  it("show fractions as percents", () => {
    expect(toShown(0.85, "fraction")).toBe("85");
    expect(fromShown("85", "fraction")).toBe(0.85);
    expect(toShown(5)).toBe("5");
  });
});
