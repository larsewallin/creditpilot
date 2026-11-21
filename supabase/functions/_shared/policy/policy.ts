/**
 * Reading the Trade Credit Policy.
 *
 *   effectivePolicy(overrides)  defaults + the company's stored policy.* rows (pure)
 *   effectiveGroups(overrides)  the company's customer groups (policy.groups), or the starter groups
 *   policyFor(policy, groups, groupKey)
 *                               the rules for one customer: its group's overrides on the company's
 *                               policy; the most specific value wins
 *   loadPolicy(db)              reads policy.* from company_settings, never throws:
 *                               a read failure falls back to the defaults and says so
 */
import { POLICY_DEFAULTS, POLICY_GROUP_DEFAULTS, POLICY_SECTIONS, type CreditPolicy, type PolicyGroup } from "./defaults.ts";

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

function merge(def: Json, over: Json): Json {
  if (!isObj(def) || !isObj(over)) return over === undefined || typeof over !== typeof def ? def : over;
  const out: Record<string, Json> = { ...def };
  for (const k of Object.keys(def)) out[k] = merge(def[k], over[k]);
  return out;
}

/** Code defaults with the company's overrides on top. Unknown or mistyped fields are ignored. */
export function effectivePolicy(overrides: Record<string, Json> = {}): CreditPolicy {
  const out: Record<string, Json> = {};
  for (const s of POLICY_SECTIONS) out[s] = merge(POLICY_DEFAULTS[s], overrides[`policy.${s}`]);
  return out as CreditPolicy;
}

/** The company's customer groups; with none stored, the starter groups. */
export function effectiveGroups(overrides: Record<string, Json> = {}): Record<string, PolicyGroup> {
  const stored = overrides["policy.groups"];
  return isObj(stored) ? stored as Record<string, PolicyGroup> : POLICY_GROUP_DEFAULTS;
}

/** The rules for one customer: its group's overrides on top of the company's policy. */
export function policyFor(policy: CreditPolicy, groups: Record<string, PolicyGroup>, groupKey?: string | null): CreditPolicy {
  const g = groupKey ? groups[groupKey] : undefined;
  if (!g || !isObj(g.overrides)) return policy;
  const out: Record<string, Json> = {};
  for (const s of POLICY_SECTIONS) out[s] = merge(policy[s], (g.overrides as Record<string, Json>)[s]);
  return out as CreditPolicy;
}

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

export interface LoadedPolicy {
  policy: CreditPolicy;
  groups: Record<string, PolicyGroup>;
  warning?: string;
}

export async function loadPolicy(db: Db): Promise<LoadedPolicy> {
  const fallback = (why: string) => ({ policy: effectivePolicy(), groups: effectiveGroups(), warning: `policy read failed, defaults used: ${why}` });
  try {
    const { data, error } = await db.from("company_settings").select("key, value").like("key", "policy.%");
    if (error) return fallback(error.message);
    const rows = (data ?? []) as { key: string; value: Json }[];
    const overrides = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { policy: effectivePolicy(overrides), groups: effectiveGroups(overrides) };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
}
