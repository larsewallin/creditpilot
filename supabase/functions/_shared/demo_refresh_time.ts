/** The demo refreshes daily at 04:00 New York (agent-scheduler → demo-actions reset). */

/** The last demo refresh: 04:00 in New York today, or yesterday before 04:00. */
export function lastDemoRefresh(now = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const nyMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const sinceRefresh = (nyMinutes - 240 + 1440) % 1440; // minutes since 04:00 New York
  return new Date(Math.floor((now.getTime() - sinceRefresh * 60_000) / 60_000) * 60_000);
}

