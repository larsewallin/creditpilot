/**
 * Agent schedules (_shared/scheduling/schedule.ts): scheduled times in a company's time zone,
 * which agents are due, and the pipeline order (monitoring agents → Risk → CIA decisioning).
 */
import { describe, it, expect } from "vitest";
import { lastSlot, plan, SCHEDULE_DEFAULTS, dispatchName, type LastRun } from "../../../scheduling/schedule.ts";
import { validateSetting, effectiveSettings } from "../../../onboarding/settings_validate.ts";

const at = (iso: string) => new Date(iso);
const done = (iso: string, minutes = 2): LastRun => ({ started_at: iso, completed_at: new Date(Date.parse(iso) + minutes * 60_000).toISOString(), status: "completed" });

describe("scheduled times", () => {
  it("every 6 hours from midnight, in UTC", () => {
    expect(lastSlot({ enabled: true, every_hours: 6, at_hour: 0 }, at("2026-11-14T13:20:00Z"), "UTC")?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(lastSlot({ enabled: true, every_hours: 6, at_hour: 0 }, at("2026-11-14T05:59:00Z"), "UTC")?.toISOString()).toBe("2026-11-14T00:00:00.000Z");
  });
  it("daily at 06:00 New York, before and after it", () => {
    expect(lastSlot({ enabled: true, every_hours: 24, at_hour: 6 }, at("2026-11-14T12:00:00Z"), "America/New_York")?.toISOString()).toBe("2026-11-14T11:00:00.000Z");
    expect(lastSlot({ enabled: true, every_hours: 24, at_hour: 6 }, at("2026-11-14T10:00:00Z"), "America/New_York")?.toISOString()).toBe("2026-11-13T11:00:00.000Z");
  });
  it("across a month start", () => {
    expect(lastSlot({ enabled: true, every_hours: 24, at_hour: 5 }, at("2026-12-01T02:00:00Z"), "UTC")?.toISOString()).toBe("2026-11-30T05:00:00.000Z");
  });
  it("weekly on Mondays", () => {
    // 2026-11-14 is a Saturday; the Monday before is 2026-11-09
    expect(lastSlot({ enabled: true, every_hours: 168, at_hour: 4 }, at("2026-11-14T12:00:00Z"), "UTC")?.toISOString()).toBe("2026-11-09T04:00:00.000Z");
    expect(lastSlot({ enabled: true, every_hours: 168, at_hour: 4 }, at("2026-11-16T03:00:00Z"), "UTC")?.toISOString()).toBe("2026-11-09T04:00:00.000Z");
  });
  it("off or invalid: no time", () => {
    expect(lastSlot({ enabled: false, every_hours: 6, at_hour: 0 }, at("2026-11-14T12:00:00Z"), "UTC")).toBeNull();
    expect(lastSlot({ enabled: true, every_hours: 5, at_hour: 0 }, at("2026-11-14T12:00:00Z"), "UTC")).toBeNull();
  });
});

describe("plan", () => {
  const now = at("2026-11-14T13:20:00Z");
  it("first run of a new production install: every monitoring agent is due, nothing after them yet", () => {
    const p = plan(SCHEDULE_DEFAULTS, {}, now);
    expect(p.due.map((d) => d.key).sort()).toEqual(["ar_aging_agent", "country_risk_agent", "credit_rating_agent", "fx_risk_agent", "industry_risk_agent", "news_monitor_agent", "payment_behaviour_agent", "sec_monitor_agent"]);
  });
  it("an agent that started after its scheduled time is not due; one started by the scheduler counts too", () => {
    const p = plan(SCHEDULE_DEFAULTS, {
      news_monitor_agent: done("2026-11-14T12:01:00Z"),
      [dispatchName("sec_monitor_agent")]: done("2026-11-14T12:00:00Z", 0),
    }, now);
    const due = p.due.map((d) => d.key);
    expect(due).not.toContain("news_monitor_agent");
    expect(due).not.toContain("sec_monitor_agent");
  });
  it("switched off: never due", () => {
    const p = plan({ ...SCHEDULE_DEFAULTS, news_monitor_agent: { enabled: false, every_hours: 6, at_hour: 0 } }, {}, now);
    expect(p.due.map((d) => d.key)).not.toContain("news_monitor_agent");
    expect(p.waiting.find((w) => w.key === "news_monitor_agent")?.reason).toBe("switched off");
  });
  const allRanToday = () => Object.fromEntries(["news_monitor_agent", "sec_monitor_agent", "ar_aging_agent", "payment_behaviour_agent",
    "country_risk_agent", "industry_risk_agent", "fx_risk_agent", "credit_rating_agent"].map((k) => [k, done("2026-11-14T12:30:00Z")]));
  it("then the Risk agent, after new country, industry or FX results", () => {
    const p = plan(SCHEDULE_DEFAULTS, allRanToday(), now);
    expect(p.due.map((d) => d.key)).toEqual(["risk_agent"]);
  });
  it("then CIA decisioning, after the Risk agent", () => {
    const p = plan(SCHEDULE_DEFAULTS, { ...allRanToday(), risk_agent: done("2026-11-14T12:50:00Z") }, now);
    expect(p.due.map((d) => d.key)).toEqual(["cia_decisioning"]);
  });
  it("then nothing until new results, even when CIA found nothing to do and recorded no run", () => {
    const p = plan(SCHEDULE_DEFAULTS, { ...allRanToday(), risk_agent: done("2026-11-14T12:50:00Z"), [dispatchName("cia_decisioning")]: done("2026-11-14T13:05:00Z", 0) }, now);
    expect(p.due).toEqual([]);
  });
  it("waits while an agent is still running", () => {
    const p = plan(SCHEDULE_DEFAULTS, { ...allRanToday(), country_risk_agent: { started_at: "2026-11-14T13:10:00Z", completed_at: null, status: "running" } }, now);
    expect(p.due).toEqual([]);
    expect(p.waiting.find((w) => w.key === "pipeline")).toBeTruthy();
  });
});

describe("settings", () => {
  it("accepts a schedule change and rejects bad values", () => {
    expect(validateSetting("agents.schedule", { timezone: "Europe/London", news_monitor_agent: { enabled: true, every_hours: 4, at_hour: 1 } })).toEqual([]);
    expect(validateSetting("agents.schedule", { timezone: "Mars/Olympus" })[0]).toMatch(/time zone/);
    expect(validateSetting("agents.schedule", { news_monitor_agent: { enabled: true, every_hours: 5, at_hour: 1 } })[0]).toMatch(/every_hours/);
    expect(validateSetting("agents.schedule", { news_monitor_agent: { enabled: true, every_hours: 6, at_hour: 24 } })[0]).toMatch(/at_hour/);
    expect(validateSetting("agents.schedule", { robot_agent: { enabled: true } })[0]).toMatch(/unknown setting/);
  });
  it("merges a saved change over the defaults", () => {
    const eff = effectiveSettings({ "agents.schedule": { news_monitor_agent: { every_hours: 2 } } }) as { agents: Record<string, { every_hours: number; enabled: boolean }> };
    expect(eff.agents.news_monitor_agent).toEqual({ enabled: true, every_hours: 2, at_hour: 0 });
    expect(eff.agents.sec_monitor_agent.every_hours).toBe(12);
  });
});
