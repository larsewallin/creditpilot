import { SCENARIO_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function ScenarioBadge({ scenario, className }: { scenario: string | null; className?: string }) {
  const s = scenario ?? "normal_operations";
  const config = SCENARIO_CONFIG[s] ?? SCENARIO_CONFIG.normal_operations;
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded text-[10px] font-medium", config.className, className)}>
      {config.label}
    </span>
  );
}
