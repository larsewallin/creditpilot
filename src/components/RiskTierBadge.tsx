import { RISK_TIER_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function RiskTierBadge({ tier, className }: { tier: string | null; className?: string }) {
  const t = tier ?? "CURRENT";
  const config = RISK_TIER_CONFIG[t] ?? RISK_TIER_CONFIG.CURRENT;
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded text-[10px] font-semibold", config.className, className)}>
      {t}
    </span>
  );
}
