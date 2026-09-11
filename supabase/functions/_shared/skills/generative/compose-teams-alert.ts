/**
 * @skill compose-teams-alert
 * @type generative
 * @description Formats an internal Teams/email alert for credit risk events.
 *   Pure formatting — no external API calls. Produces consistent, structured
 *   alert messages with severity emoji and recommended action.
 * @input TeamsAlertInput — event type, customer info, severity, details
 * @output TeamsAlertResult — subject and body ready for Teams or email delivery
 * @usedBy ar-aging-agent, news-monitor-agent, sec-monitor-agent
 */

export type AlertType =
  | "high_overdue_exposure"
  | "news_alert"
  | "sec_alert"
  | "credit_limit_action"
  | "generic";

export interface TeamsAlertInput {
  alert_type: AlertType;
  company_name: string;
  ticker?: string;
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  details: string;
  metric_label?: string;  // e.g. "Over 90 days"
  metric_value?: string;  // e.g. "$245K"
  recommended_action?: string;
}

export interface TeamsAlertResult {
  subject: string;
  body: string;
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

const ALERT_PREFIX: Record<AlertType, string> = {
  high_overdue_exposure: "AR Alert",
  news_alert: "News Alert",
  sec_alert: "SEC Alert",
  credit_limit_action: "Credit Action",
  generic: "Credit Alert",
};

export function composeTeamsAlert(input: TeamsAlertInput): TeamsAlertResult {
  const emoji = SEVERITY_EMOJI[input.severity] ?? "⚠️";
  const prefix = ALERT_PREFIX[input.alert_type] ?? "Credit Alert";
  const custLabel = input.ticker
    ? `${input.company_name} (${input.ticker})`
    : input.company_name;

  const subject = `${emoji} ${input.severity.toUpperCase()} ${prefix}: ${custLabel}`;

  const lines = [
    `${prefix} — ${input.severity.toUpperCase()}`,
    input.headline,
    "",
    `Customer: ${custLabel}`,
  ];

  if (input.metric_label && input.metric_value) {
    lines.push(`${input.metric_label}: ${input.metric_value}`);
  }

  lines.push("", input.details);

  if (input.recommended_action) {
    lines.push("", `Recommended action: ${input.recommended_action}`);
  }

  return { subject, body: lines.join("\n") };
}
