import { RISK_TIER_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** The AR aging tier is the oldest overdue bucket, not a credit-risk rating: shown as such. */
const OVERDUE_LABEL: Record<string, string> = {
  CURRENT: "Not overdue", LOW: "1–30 days", MEDIUM: "31–60 days", HIGH: "61–90 days", CRITICAL: "90+ days",
};

export function RiskTierBadge({ tier, className }: { tier: string | null; className?: string }) {
  const t = tier ?? "CURRENT";
  const config = RISK_TIER_CONFIG[t] ?? RISK_TIER_CONFIG.CURRENT;
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap", config.className, className)}>
      {OVERDUE_LABEL[t] ?? t}
    </span>
  );
}
