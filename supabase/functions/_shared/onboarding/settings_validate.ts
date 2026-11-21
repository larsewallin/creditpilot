/**
 * Validation and merging of onboarding.* settings.
 * An override is accepted only if every field exists in the code defaults and
 * has the same type (numbers must be finite and >= 0). Unknown fields are
 * rejected, so a typo cannot silently change nothing.
 * onboarding.approval has no code default yet (Phase 2): it accepts any object.
 */
import { activeScoreOrder } from "./score_providers.ts";
import { ONBOARDING_DEFAULTS } from "./settings.ts";
import { SCORE_PROVIDERS } from "./score_providers.ts";
import { AGENTS, EVERY_HOURS, SCHEDULE_DEFAULTS, validTimezone } from "../scheduling/schedule.ts";
import { POLICY_DEFAULTS, POLICY_SECTIONS } from "../policy/defaults.ts";
import { effectiveGroups, effectivePolicy } from "../policy/policy.ts";

export const SETTING_KEYS = [
  "onboarding.template",
  "onboarding.screening",
  "onboarding.limits",
  "onboarding.financials",
  "onboarding.sources",
  "onboarding.approval",
  "agents.schedule",
] as const;
export type SettingKey = typeof SETTING_KEYS[number];

/** Trade Credit Policy sections, one settings key each (policy.payments, policy.overdue, ...), and the customer groups. */
export const POLICY_KEYS = [...POLICY_SECTIONS.map((s) => `policy.${s}`), "policy.groups"];

/** policy.groups: { <key>: { name, note, overrides: { <section>: { <field>: value } } } }. */
function checkGroups(value: Record<string, Json>, errors: string[]) {
  for (const [k, g] of Object.entries(value)) {
    const where = `policy.groups.${k}`;
    if (!/^[a-z0-9_]{1,40}$/.test(k)) { errors.push(`${where}: a group key uses lowercase letters, digits and _ only`); continue; }
    if (!isObj(g)) { errors.push(`${where}: expected an object`); continue; }
    if (typeof g.name !== "string" || !g.name.trim()) errors.push(`${where}.name: give the group a name`);
    if ("note" in g && typeof g.note !== "string") errors.push(`${where}.note: expected text`);
    if (!isObj(g.overrides)) { errors.push(`${where}.overrides: expected an object`); continue; }
    for (const [s, v] of Object.entries(g.overrides)) {
      if (!(POLICY_SECTIONS as string[]).includes(s)) { errors.push(`${where}.overrides.${s}: unknown policy section`); continue; }
      check(POLICY_DEFAULTS[s as keyof typeof POLICY_DEFAULTS], v, `${where}.overrides.${s}`, errors);
    }
  }
}

/** Score sources the pipeline can call, in no particular order. A company's
 *  score_order lists the ones it uses, most trusted first; the first with a score counts. */
export const SCORE_SOURCES = [...SCORE_PROVIDERS.map((p) => p.id), "bureau_report"] as const;

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
  const isPolicy = POLICY_KEYS.includes(key);
  if (!isPolicy && !(SETTING_KEYS as readonly string[]).includes(key)) return [`${key}: unknown settings key`];
  if (!isObj(value)) return [`${key}: expected an object`];
  if (isPolicy) {
    const errors: string[] = [];
    if (key === "policy.groups") { checkGroups(value, errors); return errors; }
    check(POLICY_DEFAULTS[key.slice("policy.".length) as keyof typeof POLICY_DEFAULTS], value, key, errors);
    return errors;
  }
  if (key === "onboarding.approval") return [];
  const errors: string[] = [];
  if (key === "agents.schedule") {
    check(SCHEDULE_DEFAULTS, value, key, errors);
    const v = value as Record<string, Json>;
    if ("timezone" in v && !validTimezone(v.timezone)) errors.push(`${key}.timezone: not a time zone (use a name such as Europe/London or America/New_York)`);
    for (const a of AGENTS) {
      const s = v[a.key];
      if (!isObj(s)) continue;
      const clock = a.stage === "sense";
      if ("every_hours" in s && clock && !(EVERY_HOURS as readonly unknown[]).includes(s.every_hours)) errors.push(`${key}.${a.key}.every_hours: use ${EVERY_HOURS.join(", ")}`);
      if ("at_hour" in s && (typeof s.at_hour !== "number" || s.at_hour > 23 || !Number.isInteger(s.at_hour))) errors.push(`${key}.${a.key}.at_hour: a whole hour from 0 to 23`);
    }
    return errors;
  }
  const section = key.slice("onboarding.".length) as keyof typeof ONBOARDING_DEFAULTS;
  check(ONBOARDING_DEFAULTS[section], value, key, errors);
  if (key === "onboarding.sources" && Array.isArray((value as Record<string, Json>).score_order)) {
    const order = (value as Record<string, Json>).score_order as unknown[];
    if (new Set(order).size !== order.length) errors.push(`${key}.score_order: a source is listed twice`);
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
  // Paused sources (Keen, 2026-11-18) are not offered or shown in the order.
  const src = out.sources as { score_order?: string[] } | undefined;
  if (src?.score_order) out.sources = { ...src, score_order: activeScoreOrder(src.score_order) };
  out.approval = overrides["onboarding.approval"] ?? {};
  const sched = (overrides["agents.schedule"] ?? {}) as Record<string, Json>;
  out.policy = effectivePolicy(overrides);
  out.policy_groups = effectiveGroups(overrides);
  out.agents = Object.fromEntries(Object.entries(SCHEDULE_DEFAULTS).map(([k, d]) => [k, merge(d, sched[k])]));
  return out;
}
