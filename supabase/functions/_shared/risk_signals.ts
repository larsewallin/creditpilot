// Which events are risk signals: what the CIA counts when it combines monitors into a multi-signal
// view and a limit proposal. Good news (payments improving, a score up) and info-level events are
// not risk; counting them flagged an improving customer as "multi-signal risk" (found by the demo
// story check, 2026-11-22). One rule, used everywhere the CIA counts signals.

export const GOOD_NEWS_EVENT_TYPES = new Set(["PAYMENT_IMPROVEMENT", "CREDIT_RATING_UPGRADE", "CUSTOMER_ACTIVATED"]);

export function isRiskSignal(e: { event_type?: string | null; severity?: string | null }): boolean {
  return !GOOD_NEWS_EVENT_TYPES.has(String(e.event_type)) && e.severity !== "info";
}
