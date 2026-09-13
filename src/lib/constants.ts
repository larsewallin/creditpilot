export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export const AGENT_CONFIG = {
  news_monitor_agent: {
    label: "News Monitor",
    colorClass: "agent-news",
    borderClass: "border-l-agent-news",
    bgClass: "bg-agent-news/10",
    textClass: "text-agent-news",
    dotClass: "bg-agent-news",
  },
  ar_aging_agent: {
    label: "AR Aging",
    colorClass: "agent-aging",
    borderClass: "border-l-agent-aging",
    bgClass: "bg-agent-aging/10",
    textClass: "text-agent-aging",
    dotClass: "bg-agent-aging",
  },
  sec_monitor_agent: {
    label: "SEC Filing",
    colorClass: "agent-sec",
    borderClass: "border-l-agent-sec",
    bgClass: "bg-agent-sec/10",
    textClass: "text-agent-sec",
    dotClass: "bg-agent-sec",
  },
} as const;

export type AgentName = keyof typeof AGENT_CONFIG;

export const SCENARIO_CONFIG: Record<string, { label: string; className: string }> = {
  normal_operations: { label: "Normal", className: "bg-muted text-muted-foreground" },
  payment_issues: { label: "Payment Issues", className: "bg-agent-aging/15 text-agent-aging" },
  credit_deterioration: { label: "Credit Deterioration", className: "bg-severity-high/15 text-severity-high" },
  negative_news: { label: "Negative News", className: "bg-agent-aging/10 text-agent-aging" },
  bankruptcy: { label: "Bankruptcy", className: "bg-severity-critical/15 text-severity-critical" },
  growth_opportunity: { label: "Growth", className: "bg-agent-news/10 text-agent-news" },
  sec_filing_monitoring: { label: "SEC Monitoring", className: "bg-agent-sec/10 text-agent-sec" },
};

export const SEVERITY_CONFIG: Record<string, { className: string }> = {
  critical: { className: "bg-severity-critical/15 text-severity-critical" },
  high: { className: "bg-severity-high/15 text-severity-high" },
  medium: { className: "bg-severity-medium/15 text-severity-medium" },
  low: { className: "bg-muted text-muted-foreground" },
};

export const RISK_TIER_CONFIG: Record<string, { className: string }> = {
  CRITICAL: { className: "bg-risk-critical/15 text-risk-critical" },
  HIGH: { className: "bg-risk-high/15 text-risk-high" },
  MEDIUM: { className: "bg-risk-medium/15 text-risk-medium" },
  LOW: { className: "bg-risk-low/15 text-risk-low" },
  CURRENT: { className: "bg-risk-current/15 text-risk-current" },
};

export function getAgentConfig(agentName: string | null) {
  if (!agentName || !(agentName in AGENT_CONFIG)) {
    return { label: "System", colorClass: "agent-seed", borderClass: "border-l-agent-seed", bgClass: "bg-agent-seed/10", textClass: "text-agent-seed", dotClass: "bg-agent-seed" };
  }
  return AGENT_CONFIG[agentName as AgentName];
}
