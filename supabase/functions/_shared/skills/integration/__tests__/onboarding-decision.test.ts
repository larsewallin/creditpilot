/**
 * Proposal → NEW_CREDIT_LIMIT action and the approval helpers
 * (_shared/onboarding/decision.ts), with the real pipeline on golden prospects.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { proposalToAction, underwritingAssumptions, decisionLabel, severityFor } from "../../../onboarding/decision.ts";
import { runOnboarding } from "../../../onboarding/pipeline.ts";
import { fixtureProviders } from "../../../../../../tests/onboarding/providers.ts";

const FIX = resolve(__dirname, "../../../../../../tests/onboarding/fixtures");
const golden = async (id: string) => {
  const c = JSON.parse(readFileSync(resolve(FIX, `${id}.json`), "utf8"));
  return { app: c.application, outcome: await runOnboarding(c.application, fixtureProviders(c.sources), { asOf: c.as_of }) };
};
const now = new Date("2026-10-14T12:00:00Z");
const row = { id: "app-1", customer_id: "cust-1", decision_due_at: "2026-11-10T00:00:00Z" };

describe("proposalToAction", () => {
  it("turns a counteroffer into a NEW_CREDIT_LIMIT action with the memo and the Reg B due date", async () => {
    const { app, outcome } = await golden("G10");
    const a = proposalToAction(row, app, outcome, { runId: "r", isDemo: true, now });
    expect(a).toMatchObject({ action_type: "NEW_CREDIT_LIMIT", customer_id: "cust-1", application_id: "app-1", current_value: 0,
      proposed_value: 200_000, requested_value: 220_000, supportable_value: 200_000, binding_method: "working_capital",
      severity: "medium", status: "pending", is_demo: true, expires_at: "2026-11-10T00:00:00.000Z", agent_name: "cia-agent" });
    expect(a.rationale).toContain("Counteroffer $200,000 (requested $220,000)");
  });
  it("proposes zero and marks critical for a sanctions match", async () => {
    const { app, outcome } = await golden("G06");
    const a = proposalToAction(row, app, outcome, { runId: "r", isDemo: false, now });
    expect(a.proposed_value).toBe(0);
    expect(a.severity).toBe("critical");
    expect(a.memo.headline).toBe("Decline for review: sanctions match");
  });
  it("defaults the due date to 30 days when the clock was not set", async () => {
    const { app, outcome } = await golden("G01");
    const a = proposalToAction({ ...row, decision_due_at: null }, app, outcome, { runId: "r", isDemo: false, now });
    expect(a.expires_at).toBe("2026-11-13T12:00:00.000Z");
    expect(severityFor(outcome)).toBe("info");
  });
});

describe("underwritingAssumptions", () => {
  it("records what the approval rested on, for monitoring to test later", async () => {
    const { app, outcome } = await golden("G10");
    const b = underwritingAssumptions(app, outcome, 200_000);
    expect(b).toMatchObject({ approved_limit_usd: 200_000, score: 91, band: "A", invoicing_currency: "EUR", country_code: "DE", binding_method: "working_capital" });
    expect(b.macro_context_at_approval.map((m) => m.key)).toEqual(["DE", "EUR"]);
    expect(b.screening_at_approval?.status).toBe("pass");
  });
});

describe("decisionLabel", () => {
  it("labels approvals and declines", () => {
    expect(decisionLabel("approve", 100, 100)).toBe("approve_as_requested");
    expect(decisionLabel("approve", 80, 100)).toBe("counteroffer");
    expect(decisionLabel("decline", 0, 100)).toBe("declined");
  });
});
