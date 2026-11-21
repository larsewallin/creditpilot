/**
 * Reading the Trade Credit Policy.
 *
 *   effectivePolicy(overrides)  defaults + the company's stored policy.* rows (pure)
 *   loadPolicy(db)              reads policy.* from company_settings, never throws:
 *                               a read failure falls back to the defaults and says so
 */
import { POLICY_DEFAULTS, POLICY_SECTIONS, type CreditPolicy } from "./defaults.ts";

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

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

export async function loadPolicy(db: Db): Promise<{ policy: CreditPolicy; warning?: string }> {
  try {
    const { data, error } = await db.from("company_settings").select("key, value").like("key", "policy.%");
    if (error) return { policy: effectivePolicy(), warning: `policy read failed, defaults used: ${error.message}` };
    const rows = (data ?? []) as { key: string; value: Json }[];
    return { policy: effectivePolicy(Object.fromEntries(rows.map((r) => [r.key, r.value]))) };
  } catch (e) {
    return { policy: effectivePolicy(), warning: `policy read failed, defaults used: ${e instanceof Error ? e.message : String(e)}` };
  }
}
