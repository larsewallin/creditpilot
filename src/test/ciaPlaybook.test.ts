import { describe, expect, it } from "vitest";
import { availableSteps, capabilityStatus, isAdviceQuestion, playbookBlock, PLAYBOOK, CAPABILITIES } from "../../supabase/functions/_shared/cia_playbook";
import { agentLabel, sourceLabel } from "@/lib/sourceLabels";

describe("CIA next-steps playbook", () => {
  it("offers no step that needs data CreditPilot does not track", () => {
    const steps = availableSteps(capabilityStatus());
    expect(steps.some((s) => s.needs)).toBe(false);
    expect(steps.map((s) => s.text).join(" ")).not.toMatch(/collateral|guarantee|letter of credit|insurance/i);
  });

  it("unlocks a capability's steps once its data exists", () => {
    const steps = availableSteps(capabilityStatus((k) => k === "collateral"));
    expect(steps.map((s) => s.key)).toContain("check_collateral");
    expect(steps.map((s) => s.key)).not.toContain("check_insurance");
  });

  it("every step's capability is a known one", () => {
    const keys = new Set(CAPABILITIES.map((c) => c.key));
    for (const s of PLAYBOOK) if (s.needs) expect(keys.has(s.needs)).toBe(true);
  });

  it("lists untracked data once, as mention-only-if-asked", () => {
    const block = playbookBlock(capabilityStatus());
    expect(block).toMatch(/Not tracked in CreditPilot yet \(mention only if the user asks/);
    expect(block).toMatch(/Ask the customer for its latest annual accounts/);
    expect(playbookBlock(capabilityStatus(() => true))).not.toMatch(/Not tracked/);
  });

  it("tells advice questions from lookups", () => {
    for (const q of ["Should we extend Arconic's payment terms?", "Can we raise Lockheed's limit?", "What should I do about Brixton?", "Do we need collateral from Heliogen?"])
      expect(isAdviceQuestion(q)).toBe(true);
    for (const q of ["What is our total overdue AR?", "Who is the account manager for Kaman?", "List Arconic's overdue invoices."])
      expect(isAdviceQuestion(q)).toBe(false);
  });
});

describe("CIA source labels", () => {
  it("names agents and records in plain words", () => {
    expect(agentLabel("payment_behaviour_agent")).toBe("Payments");
    expect(agentLabel("ar_aging_agent")).toBe("AR aging");
    expect(agentLabel("fx_risk_agent")).toBe("FX");
    expect(agentLabel(null, "customers")).toBe("Customer");
    expect(sourceLabel({ event_type: "OVERDUE_AR", source_type: "credit_events" })).toBe("Overdue invoices");
    expect(sourceLabel({ event_type: null, source_type: "customers" })).toBe("Customer record");
  });
});
