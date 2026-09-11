import { SEVERITY_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function SeverityBadge({ severity, className }: { severity: string | null; className?: string }) {
  const s = severity ?? "low";
  const config = SEVERITY_CONFIG[s] ?? SEVERITY_CONFIG.low;
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase", config.className, className)}>
      {s}
    </span>
  );
}
