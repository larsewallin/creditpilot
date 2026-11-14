/**
 * Validation and merging of onboarding.* settings.
 * An override is accepted only if every field exists in the code defaults and
 * has the same type (numbers must be finite and >= 0). Unknown fields are
 * rejected, so a typo cannot silently change nothing.
 * onboarding.approval has no code default yet (Phase 2): it accepts any object.
 */
import { ONBOARDING_DEFAULTS } from "./settings.ts";

export const SETTING_KEYS = [
  "onboarding.template",
  "onboarding.screening",
  "onboarding.limits",
  "onboarding.financials",
  "onboarding.sources",
  "onboarding.approval",
] as const;
export type SettingKey = typeof SETTING_KEYS[number];

/** Score sources the pipeline can call, in no particular order. A company's
 *  score_order lists the ones it uses, most trusted first; the first with a score counts. */
export const SCORE_SOURCES = ["keen", "bureau_report"] as const;

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

function check(def: Json, val: Json, path: string, errors: string[]) {
  if (isObj(def)) {
    if (!isObj(val)) { errors.push(`${path}: expected an object`); return; }
    for (const k of Object.keys(val)) {
      if (!(k in def)) { errors.push(`${path}.${k}: unknown setting`); continue; }
      check(def[k], val[k], `${path}.${k}`, errors);
    }
  } else if (typeof def === "number") {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) errors.push(`${path}: expected a number >= 0`);
  } else if (Array.isArray(def)) {
    if (!Array.isArray(val) || !val.every((x) => typeof x === "string")) errors.push(`${path}: expected a list of text values`);
  } else if (typeof def === "string") {
    if (typeof val !== "string") errors.push(`${path}: expected text`);
  } else if (typeof def === "boolean") {
    if (typeof val !== "boolean") errors.push(`${path}: expected true or false`);
  }
}

/** Returns a list of problems; empty means the value is acceptable. */
export function validateSetting(key: string, value: Json): string[] {
  if (!(SETTING_KEYS as readonly string[]).includes(key)) return [`${key}: unknown settings key`];
  if (!isObj(value)) return [`${key}: expected an object`];
  if (key === "onboarding.approval") return [];
  const section = key.slice("onboarding.".length) as keyof typeof ONBOARDING_DEFAULTS;
  const errors: string[] = [];
  check(ONBOARDING_DEFAULTS[section], value, key, errors);
  if (key === "onboarding.sources" && Array.isArray((value as Record<string, Json>).score_order)) {
    const order = (value as Record<string, Json>).score_order as unknown[];
    for (const s of order) if (!(SCORE_SOURCES as readonly unknown[]).includes(s)) errors.push(`${key}.score_order: unknown score source "${s}" (known: ${SCORE_SOURCES.join(", ")})`);
    if (order.length === 0) errors.push(`${key}.score_order: list at least one score source`);
  }
  return errors;
}

function merge(def: Json, over: Json): Json {
  if (!isObj(def) || !isObj(over)) return over === undefined ? def : over;
  const out: Record<string, Json> = { ...def };
  for (const k of Object.keys(over)) out[k] = merge(def[k], over[k]);
  return out;
}

/** Code defaults with the company's stored overrides applied on top. */
export function effectiveSettings(overrides: Record<string, Json>) {
  const out: Record<string, Json> = {};
  for (const section of Object.keys(ONBOARDING_DEFAULTS) as (keyof typeof ONBOARDING_DEFAULTS)[]) {
    out[section] = merge(ONBOARDING_DEFAULTS[section], overrides[`onboarding.${section}`]);
  }
  out.approval = overrides["onboarding.approval"] ?? {};
  return out;
}
