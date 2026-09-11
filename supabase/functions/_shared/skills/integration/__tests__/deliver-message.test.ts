import { describe, it, expect } from "vitest";
import {
  LogProvider,
  EmailProvider,
  TeamsProvider,
  deliverMessage,
  type OutboundMessage,
  type MessageProvider,
  type DeliveryResult,
} from "../deliver-message";

const MSG: OutboundMessage = {
  channel: "email",
  recipient: "test@example.com",
  subject: "Test alert",
  body: "This is a test message body.",
};

describe("LogProvider", () => {
  it("always returns success=true", async () => {
    const provider = new LogProvider();
    const result = await provider.deliver(MSG);
    expect(result.success).toBe(true);
    expect(result.provider).toBe("log");
  });
});

describe("EmailProvider", () => {
  it("with no API key returns success=false", async () => {
    const provider = new EmailProvider("");
    const result = await provider.deliver(MSG);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("TeamsProvider", () => {
  it("with no webhook URL returns success=false", async () => {
    const provider = new TeamsProvider("");
    const result = await provider.deliver({ ...MSG, channel: "teams" });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("deliverMessage", () => {
  it("with empty providers falls back to LogProvider and succeeds", async () => {
    const result = await deliverMessage(MSG, []);
    expect(result.success).toBe(true);
    expect(result.provider).toBe("log");
  });

  it("with failing provider falls back to next provider (LogProvider) and succeeds", async () => {
    const failingProvider: MessageProvider = {
      name: "failing",
      channel: "email",
      deliver: async (): Promise<DeliveryResult> => ({
        success: false,
        provider: "failing",
        error: "always fails",
      }),
    };
    const result = await deliverMessage(MSG, [failingProvider]);
    expect(result.success).toBe(true);
    expect(result.provider).toBe("log");
  });
});
