import { getAgentConfig } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function AgentPill({ agentName, className }: { agentName: string | null; className?: string }) {
  const config = getAgentConfig(agentName);
  // Readable names ("AR Aging"), not internal ones ("ar_aging_agent").
  const label = agentName === "cia-agent" ? "Assistant" : config.label !== "System" ? config.label : (agentName ?? "System");
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium", config.bgClass, config.textClass, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dotClass)} />
      {label}
    </span>
  );
}
