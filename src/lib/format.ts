import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";

export function relativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return formatDistanceToNow(d, { addSuffix: true });
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return "0%";
  return `${value.toFixed(1)}%`;
}

/**
 * Colour for a score on CreditPilot's one scale (score_scale.ts): Adequate (55) and better are
 * good credits, Watch is amber, Elevated orange, High risk red.
 */
export function scoreColor(score: number | null): string {
  if (score == null) return "";
  if (score >= 55) return "text-risk-current";
  if (score >= 40) return "text-agent-aging";
  if (score >= 25) return "text-severity-high";
  return "text-severity-critical";
}
