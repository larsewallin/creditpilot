/**
 * @skill compose-dunning-letter
 * @type generative
 * @description Composes a personalised dunning letter using the Anthropic Claude API.
 *   Incorporates payment trend, relationship length, on-time rate, and preferred-customer
 *   status to calibrate tone. Falls back to a structured template if the API call fails
 *   or no API key is provided.
 * @input DunningLetterInput — customer context + AR aging buckets + payment history
 * @output DunningLetterResult — email subject and body, plus generation source
 * @usedBy ar-aging-agent
 */

export interface DunningLetterInput {
  company_name: string;
  ticker?: string;
  contact_name?: string;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  credit_limit: number;
  utilization_pct: number;
  payment_terms_days?: number;
  on_time_rate?: number;        // 0–1
  avg_days_early_late?: number; // negative = pays early on average
  relationship_months?: number;
  is_strategic_account?: boolean;
  payment_health?: "healthy" | "watch" | "at_risk" | "unknown";
  dunning_stage?: 1 | 2 | 3 | 4 | 5 | 6; // 1 = friendly reminder, 6 = collections handoff
  anthropic_api_key?: string;
}

export interface DunningLetterResult {
  subject: string;
  body: string;
  generated_by: "claude" | "template";
}

const STAGE_TONE: Record<number, string> = {
  1: "friendly and professional — this is an early reminder, preserve the relationship",
  2: "firm but respectful — payment is overdue and needs attention",
  3: "urgent — a significant amount is at risk, escalation is possible",
  4: "final notice — payment must be received immediately to avoid escalation to collections",
  5: "legal referral — payment must be received within 5 business days to avoid legal proceedings, tone is formal and firm, no negotiation language",
  6: "collections handoff — account has been referred to external collections, tone is formal and factual, direct all future communication to collections agency",
};

export async function composeDunningLetter(
  input: DunningLetterInput
): Promise<DunningLetterResult> {
  const totalOverdue =
    (input.days_31_60 ?? 0) + (input.days_61_90 ?? 0) + (input.days_over_90 ?? 0);
  const stage = input.dunning_stage ?? 1;

  if (input.anthropic_api_key) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": input.anthropic_api_key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 800,
          messages: [
            { role: "user", content: buildPrompt(input, totalOverdue, stage) },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text: string = data.content?.[0]?.text ?? "";

        const subjectMatch = text.match(/Subject:\s*(.+)/i);
        const bodyStart = text.indexOf("\n\n");
        const subject =
          subjectMatch?.[1]?.trim() ?? fallbackSubject(input.company_name, totalOverdue);
        const body = bodyStart > -1 ? text.slice(bodyStart).trim() : text;

        if (body.length > 50) {
          return { subject, body, generated_by: "claude" };
        }
      }
    } catch {
      // fall through to template
    }
  }

  return buildTemplate(input, totalOverdue, stage);
}

function buildPrompt(
  input: DunningLetterInput,
  totalOverdue: number,
  stage: number
): string {
  const onTimeRate =
    input.on_time_rate != null
      ? `${Math.round(input.on_time_rate * 100)}%`
      : "unknown";
  const avgDays =
    input.avg_days_early_late != null
      ? input.avg_days_early_late > 0
        ? `${input.avg_days_early_late} days late on average`
        : `${Math.abs(input.avg_days_early_late)} days early on average`
      : "unknown";
  const relLength = input.relationship_months
    ? `${input.relationship_months} months`
    : "unknown";

  return `You are a credit manager at a B2B distributor writing a dunning letter to a customer.

Tone: ${STAGE_TONE[stage] ?? STAGE_TONE[1]}

Customer context:
- Company: ${input.company_name}${input.ticker ? ` (${input.ticker})` : ""}
- Contact: ${input.contact_name ?? "Accounts Payable"}
- Relationship length: ${relLength}
- Strategic account: ${input.is_strategic_account ? "Yes (key account)" : "No"}
- Payment terms: Net ${input.payment_terms_days ?? 30}

AR aging:
- 31–60 days overdue: $${(input.days_31_60 ?? 0).toLocaleString()}
- 61–90 days overdue: $${(input.days_61_90 ?? 0).toLocaleString()}
- Over 90 days overdue: $${(input.days_over_90 ?? 0).toLocaleString()}
- Total overdue: $${totalOverdue.toLocaleString()}
- Credit utilization: ${input.utilization_pct}%

Payment history:
- On-time payment rate: ${onTimeRate}
- Average payment timing: ${avgDays}
- Payment health: ${input.payment_health ?? "unknown"}

Tone guidance based on payment health: If payment_health is at_risk, emphasise the urgency and deteriorating pattern. If watch, note the payment trend. If healthy, acknowledge their payment history while still requesting settlement.

Write a dunning letter. Start with "Subject: [subject line]" then a blank line, then the letter body.
Sign off as "Credit Management Team". Keep it under 200 words.`;
}

function fallbackSubject(companyName: string, totalOverdue: number): string {
  return `Payment Reminder — $${(totalOverdue / 1000).toFixed(0)}K overdue balance`;
}

function buildTemplate(
  input: DunningLetterInput,
  totalOverdue: number,
  stage: number
): DunningLetterResult {
  const contact = input.contact_name ?? `${input.company_name} Accounts Payable`;

  const subjectOverride: Record<number, string> = {
    5: `URGENT: Legal Referral Notice — ${input.company_name} Outstanding Balance`,
    6: `Collections Notice — ${input.company_name} Account Referred`,
  };
  const subject = subjectOverride[stage] ?? fallbackSubject(input.company_name, totalOverdue);

  const opener: Record<number, string> = {
    1: "This is a friendly reminder regarding your outstanding balance.",
    2: "We are following up on an overdue balance that requires your attention.",
    3: "This is an urgent notice regarding a significantly overdue balance on your account.",
    4: "This is a final notice. Immediate payment is required to avoid escalation to collections.",
    5: "URGENT NOTICE: Your account has been escalated for legal referral. Payment in full must be received within 5 business days to avoid legal proceedings.",
    6: "This account has been referred to our external collections agency. All future communications regarding this balance should be directed to the collections agency.",
  };

  const body = `Dear ${contact},

${opener[stage] ?? opener[1]}

Outstanding balance: $${totalOverdue.toLocaleString()}

AR aging breakdown:
• 31–60 days: $${(input.days_31_60 ?? 0).toLocaleString()}
• 61–90 days: $${(input.days_61_90 ?? 0).toLocaleString()}
• Over 90 days: $${(input.days_over_90 ?? 0).toLocaleString()}

Credit utilization: ${input.utilization_pct}% of your $${(input.credit_limit ?? 0).toLocaleString()} limit.

Please arrange payment or contact us to discuss your account.

Best regards,
Credit Management Team`;

  return { subject, body, generated_by: "template" };
}
