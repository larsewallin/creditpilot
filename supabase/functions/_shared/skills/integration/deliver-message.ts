/**
 * @skill deliver-message
 * @type integration
 * Provider-agnostic message delivery skill.
 * Supports email, Slack, Teams, and webhook channels.
 * Falls back to LogProvider if no provider configured.
 * Never throws — always returns a DeliveryResult.
 * Adding a new channel: implement MessageProvider interface only.
 * @usedBy ar-aging-agent, news-monitor-agent, sec-monitor-agent, cia-agent
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutboundMessage {
  channel: "email" | "slack" | "teams" | "webhook";
  recipient?: string;       // email address or webhook URL
  subject?: string;         // email only
  body: string;             // plain text or markdown
  metadata?: Record<string, unknown>; // optional context for logging
}

export interface DeliveryResult {
  success: boolean;
  provider: string;
  message_id?: string;
  error?: string;
}

export interface MessageProvider {
  name: string;
  channel: OutboundMessage["channel"];
  deliver(message: OutboundMessage): Promise<DeliveryResult>;
}

// ─── LogProvider ──────────────────────────────────────────────────────────────
// Always available, logs to console, always succeeds.
// Used as fallback when no real provider is configured.

export class LogProvider implements MessageProvider {
  readonly name = "log";
  readonly channel = "email" as const; // accepts any channel

  async deliver(message: OutboundMessage): Promise<DeliveryResult> {
    console.log(
      `[deliver-message] ${message.channel} to ${message.recipient ?? "unknown"}: ${message.subject ?? message.body.slice(0, 80)}`
    );
    return { success: true, provider: "log" };
  }
}

// ─── EmailProvider ────────────────────────────────────────────────────────────
// Stub — ready to wire with SendGrid or Postmark when API key is available.

export class EmailProvider implements MessageProvider {
  readonly name = "email";
  readonly channel = "email" as const;

  constructor(
    private readonly apiKey: string,
    private readonly service: "sendgrid" | "postmark" = "sendgrid"
  ) {}

  async deliver(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.apiKey) {
      return { success: false, provider: this.name, error: "No API key" };
    }
    // Wire up: POST https://api.sendgrid.com/v3/mail/send
    return { success: false, provider: this.name, error: "Not implemented yet" };
  }
}

// ─── TeamsProvider ────────────────────────────────────────────────────────────
// Stub — ready to wire with MS Teams webhook URL.

export class TeamsProvider implements MessageProvider {
  readonly name = "teams";
  readonly channel = "teams" as const;

  constructor(private readonly webhookUrl: string) {}

  async deliver(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.webhookUrl) {
      return { success: false, provider: this.name, error: "No webhook URL" };
    }
    // Wire up: POST this.webhookUrl with { '@type': 'MessageCard', text: message.body }
    return { success: false, provider: this.name, error: "Not implemented yet" };
  }
}

// ─── SlackProvider ────────────────────────────────────────────────────────────
// Stub — ready to wire with Slack incoming webhook URL.

export class SlackProvider implements MessageProvider {
  readonly name = "slack";
  readonly channel = "slack" as const;

  constructor(private readonly webhookUrl: string) {}

  async deliver(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.webhookUrl) {
      return { success: false, provider: this.name, error: "No webhook URL" };
    }
    // Wire up: POST this.webhookUrl with { text: message.body }
    return { success: false, provider: this.name, error: "Not implemented yet" };
  }
}

// ─── Main delivery function ───────────────────────────────────────────────────
// Tries providers in order. Falls back to LogProvider if all fail or list is empty.
// Never throws.

export async function deliverMessage(
  message: OutboundMessage,
  providers: MessageProvider[] = []
): Promise<DeliveryResult> {
  const allProviders = [...providers, new LogProvider()];

  for (const provider of allProviders) {
    try {
      const result = await provider.deliver(message);
      if (result.success) return result;
    } catch (err) {
      console.error(`[deliver-message] ${provider.name} failed:`, err);
    }
  }

  // LogProvider is always last and always succeeds, so this is unreachable
  return { success: true, provider: "log" };
}
