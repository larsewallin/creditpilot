import { getAgentConfig } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function AgentPill({ agentName, className }: { agentName: string | null; className?: string }) {
  const config = getAgentConfig(agentName);
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium font-mono", config.bgClass, config.textClass, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dotClass)} />
      {agentName ?? "system"}
    </span>
  );
}
