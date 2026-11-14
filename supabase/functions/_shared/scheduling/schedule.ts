/**
 * Agent schedules: which agent runs when, set by each company in Settings › Agent schedules
 * (company_settings key "agents.schedule"). Pure: no clock, no database. The agent-scheduler
 * function supplies "now" and the last runs from agent_runs.
 *
 * A schedule is { enabled, every_hours, at_hour }:
 *   every_hours 1, 2, 3, 4, 6, 8 or 12: at at_hour and every every_hours after it, each day
 *   every_hours 24:  daily at at_hour
 *   every_hours 168: weekly, Mondays at at_hour
 * Hours are in the company's time zone (agents.schedule.timezone, an IANA name; default UTC).
 *
 * An agent is due when it is enabled and has not started since its most recent scheduled
 * time. The pipeline after the monitoring agents keeps Reset Demo's order: the Risk agent
 * runs after Country, Industry or FX have produced something new, and CIA's decisioning
 * after any agent has. Those two have no clock of their own.
 */

export interface AgentSchedule { enabled: boolean; every_hours: number; at_hour: number }

export interface AgentDef {
  /** settings key */
  key: string;
  /** edge function to call */
  fn: string;
  /** agent_runs.agent_name the function records */
  run_name: string;
  label: string;
  stage: "sense" | "risk" | "decide";
}

export const AGENTS: AgentDef[] = [
  { key: "news_monitor_agent", fn: "news-monitor-agent", run_name: "news_monitor_agent", label: "News Monitor", stage: "sense" },
  { key: "sec_monitor_agent", fn: "sec-monitor-agent", run_name: "sec_monitor_agent", label: "SEC Filings", stage: "sense" },
  { key: "ar_aging_agent", fn: "ar-aging-agent", run_name: "ar_aging_agent", label: "AR Aging", stage: "sense" },
  { key: "payment_behaviour_agent", fn: "payment-behaviour-agent", run_name: "payment_behaviour_agent", label: "Payment Behaviour", stage: "sense" },
  { key: "country_risk_agent", fn: "country-risk-agent", run_name: "country_risk_agent", label: "Country Risk", stage: "sense" },
  { key: "industry_risk_agent", fn: "industry-risk-agent", run_name: "industry_risk_agent", label: "Industry Risk", stage: "sense" },
  { key: "fx_risk_agent", fn: "fx-risk-agent", run_name: "fx_risk_agent", label: "FX Risk", stage: "sense" },
  { key: "credit_rating_agent", fn: "credit-rating-agent", run_name: "credit_rating_agent", label: "Credit Rating", stage: "sense" },
  { key: "risk_agent", fn: "risk-agent", run_name: "risk_agent", label: "Risk (maps country, industry and FX to customers)", stage: "risk" },
  { key: "cia_decisioning", fn: "cia-agent", run_name: "cia-agent", label: "CIA decisioning (proposes actions)", stage: "decide" },
];

/** The agents whose events the Risk agent maps onto customers. */
export const MACRO_AGENTS = ["country_risk_agent", "industry_risk_agent", "fx_risk_agent"];

export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12, 24, 168] as const;

export const SCHEDULE_DEFAULTS = {
  timezone: "UTC",
  news_monitor_agent: { enabled: true, every_hours: 6, at_hour: 0 },
  sec_monitor_agent: { enabled: true, every_hours: 12, at_hour: 3 },
  ar_aging_agent: { enabled: true, every_hours: 24, at_hour: 6 },
  payment_behaviour_agent: { enabled: true, every_hours: 24, at_hour: 6 },
  country_risk_agent: { enabled: true, every_hours: 24, at_hour: 5 },
  industry_risk_agent: { enabled: true, every_hours: 24, at_hour: 5 },
  fx_risk_agent: { enabled: true, every_hours: 24, at_hour: 5 },
  credit_rating_agent: { enabled: true, every_hours: 24, at_hour: 4 },
  // no clock of their own: they follow the agents above
  risk_agent: { enabled: true, every_hours: 0, at_hour: 0 },
  cia_decisioning: { enabled: true, every_hours: 0, at_hour: 0 },
};
export type ScheduleSettings = typeof SCHEDULE_DEFAULTS;

export interface LastRun { started_at: string; completed_at: string | null; status: string }

/** agent_runs.agent_name of the scheduler's own record that it started an agent ("scheduler:news_monitor_agent").
 *  It counts as a start, so an agent that ends early without recording a run (CIA with no new
 *  events, a rate limit) is not started again on every tick. */
export const dispatchName = (key: string) => `scheduler:${key}`;

/** Local calendar parts of an instant in a time zone. */
function localParts(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(String(p.weekday));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, weekday: wd };
}

/** The instant of a local wall-clock time (hour granularity) in a time zone. */
function instantOf(y: number, m: number, d: number, h: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h));
  const p = localParts(guess, tz);
  const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

export function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** The most recent scheduled time at or before `now`, or null for a schedule with no clock. */
export function lastSlot(s: AgentSchedule, now: Date, tz: string): Date | null {
  if (!s.enabled || !(EVERY_HOURS as readonly number[]).includes(s.every_hours)) return null;
  const at = Math.max(0, Math.min(23, Math.floor(s.at_hour)));
  const p = localParts(now, tz);
  if (s.every_hours === 168) {
    // Mondays at `at`: step back to this week's Monday, a week further if it is still ahead
    let back = p.weekday;
    let t = instantOf(p.y, p.m, p.d - back, at, tz);
    if (t > now) { back += 7; t = instantOf(p.y, p.m, p.d - back, at, tz); }
    return t;
  }
  const step = s.every_hours;
  // hours of the day this schedule fires: at, at+step, … (mod 24)
  const hours = [...new Set(Array.from({ length: Math.ceil(24 / step) }, (_, i) => (at + i * step) % 24))].sort((a, b) => a - b);
  const today = hours.filter((h) => h <= p.h).pop();
  if (today !== undefined) return instantOf(p.y, p.m, p.d, today, tz);
  return instantOf(p.y, p.m, p.d - 1, hours[hours.length - 1], tz);
}

/** Started recently and not finished: leave it alone. */
export function isRunning(r: LastRun | undefined, now: Date): boolean {
  return !!r && r.status === "running" && now.getTime() - Date.parse(r.started_at) < 30 * 60_000;
}

export interface Plan {
  due: { key: string; fn: string; label: string; reason: string }[];
  waiting: { key: string; reason: string }[];
}

/**
 * What to start now. One stage per tick: the monitoring agents that are due; else the Risk
 * agent if Country, Industry or FX finished something since it last started; else CIA's
 * decisioning if any agent finished since it last started. The next tick (15 minutes later)
 * picks up the next stage, so no call has to wait for another.
 */
export function plan(settings: ScheduleSettings, last: Record<string, LastRun | undefined>, now: Date): Plan {
  const tz = validTimezone(settings.timezone) ? settings.timezone : "UTC";
  const sched = (key: string): AgentSchedule => ({ ...(SCHEDULE_DEFAULTS as Record<string, unknown>)[key] as AgentSchedule, ...((settings as Record<string, unknown>)[key] as AgentSchedule | undefined) });
  const out: Plan = { due: [], waiting: [] };
  const lastOf = (key: string) => last[AGENTS.find((a) => a.key === key)!.run_name];
  // latest start: the agent's own run or the scheduler starting it, whichever is later
  const startedAt = (key: string): string | undefined => {
    const a = last[AGENTS.find((x) => x.key === key)!.run_name]?.started_at;
    const d = last[dispatchName(key)]?.started_at;
    if (!a) return d;
    if (!d) return a;
    return Date.parse(a) >= Date.parse(d) ? a : d;
  };
  const finishedAfter = (keys: string[], since?: string) => keys.some((k) => {
    const r = lastOf(k);
    return !!r?.completed_at && r.status === "completed" && (!since || Date.parse(r.completed_at) > Date.parse(since));
  });
  const anyRunning = AGENTS.some((a) => isRunning(last[a.run_name], now));

  for (const a of AGENTS.filter((x) => x.stage === "sense")) {
    const s = sched(a.key);
    if (!s.enabled) { out.waiting.push({ key: a.key, reason: "switched off" }); continue; }
    const slot = lastSlot(s, now, tz);
    const r = last[a.run_name];
    if (!slot) { out.waiting.push({ key: a.key, reason: "no valid schedule" }); continue; }
    if (isRunning(r, now)) { out.waiting.push({ key: a.key, reason: "running" }); continue; }
    const started = startedAt(a.key);
    if (started && Date.parse(started) >= slot.getTime()) { out.waiting.push({ key: a.key, reason: `started at ${started}` }); continue; }
    out.due.push({ key: a.key, fn: a.fn, label: a.label, reason: `scheduled ${slot.toISOString()}` });
  }
  if (out.due.length) return out;
  if (anyRunning) { out.waiting.push({ key: "pipeline", reason: "an agent is still running" }); return out; }

  const risk = AGENTS.find((a) => a.key === "risk_agent")!;
  if (sched("risk_agent").enabled && finishedAfter(MACRO_AGENTS, startedAt("risk_agent"))) {
    out.due.push({ key: risk.key, fn: risk.fn, label: risk.label, reason: "new country, industry or FX results" });
    return out;
  }
  const cia = AGENTS.find((a) => a.key === "cia_decisioning")!;
  const others = AGENTS.filter((a) => a.stage !== "decide").map((a) => a.key);
  if (sched("cia_decisioning").enabled && finishedAfter(others, startedAt("cia_decisioning"))) {
    out.due.push({ key: cia.key, fn: cia.fn, label: cia.label, reason: "new agent results" });
  }
  return out;
}
