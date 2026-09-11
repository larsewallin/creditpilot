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

export function scoreColor(score: number | null): string {
  if (score == null) return "";
  if (score >= 80) return "text-risk-current";
  if (score >= 60) return "text-agent-aging";
  if (score >= 40) return "text-severity-high";
  return "text-severity-critical";
}
