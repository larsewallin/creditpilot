import { describe, it, expect } from "vitest";
import { composeOnboardingMemo } from "../compose-onboarding-memo.ts";
import type { CreditApplication, OnboardingOutcome } from "../../../onboarding/types.ts";

const app: CreditApplication = {
  application_id: "A1", submitted_by: "credit_team", legal_name: "Rheinfeld Spezialchemie GmbH", country_code: "DE",
  people: [], trade_references: [], financial_statements: [], signatures: {},
  credit_request: { amount_usd: 220_000, terms_days: 60, monthly_purchases_usd: 100_000, invoicing_currency: "EUR" },
};
const outcome: OnboardingOutcome = {
  application_id: "A1", stopped_at: "decision", events: [],
  screening: { status: "pass", checks: ["registry:gleif", "tax_id:vies", "sanctions_entity", "sanctions_people"], people_screened: 2, hits: [], fraud_flags: [] },
  analysis: { financials_source: "uploaded_statements", statement_quality: "audited", score_source: "file", score: 91, band: "A", fallbacks: [],
    macro_context: [{ source_agent: "country_risk_agent", event_type: "COUNTRY_RATING_CHANGE", severity: "high", key: "DE", title: "Germany outlook cut to negative" }] },
  proposal: { decision: "counteroffer", human_required: true, requested_usd: 220_000, recommended_usd: 200_000, supportable_usd: 200_000,
    proposed_usd: 200_000, binding_method: "working_capital", higher_limit_note: false, macro_haircut_applied: true,
    reason_codes: ["MACRO_COUNTRY_RISK", "LIMIT_CAPPED_WORKING_CAPITAL"], needs_usd: 230_000, caps: { working_capital: 250_000, net_worth: 400_000 }, risk_adjusted_cap_usd: 200_000 },
};

describe("composeOnboardingMemo", () => {
  const m = composeOnboardingMemo(app, outcome);
  it("leads with the decision in plain words", () => {
    expect(m.headline).toBe("Counteroffer $200,000 (requested $220,000)");
    expect(m.recommendation).toBe("counteroffer");
  });
  it("shows the limit working with every cap", () => {
    const w = m.sections.find((s) => s.title === "Limit working")!;
    expect(w.lines.join(" ")).toContain("$230,000");
    expect(w.lines.join(" ")).toContain("Working-capital cap: $250,000");
    expect(w.lines.join(" ")).toContain("bound by working capital");
  });
  it("cites its sources", () => {
    expect(m.sections.find((s) => s.title === "Credit analysis")!.sources).toEqual(["Statements uploaded with the application", "File scoring app"]);
    expect(m.sections.find((s) => s.title === "Market context")!.sources).toEqual(["Country Risk agent"]);
    expect(m.sections.find((s) => s.title === "Screening")!.sources).toContain("EU VIES VAT check");
  });
  it("explains reason codes and says a person decides", () => {
    expect(m.text).toContain("A high or critical country-risk signal applies");
    expect(m.text).toContain("A person must approve");
  });
  it("words a sanctions decline and shows the hit", () => {
    const s = composeOnboardingMemo(app, { ...outcome, analysis: undefined,
      screening: { ...outcome.screening!, status: "fail", hits: [{ subject: "Kestrel Petrochem Trading FZE", subject_type: "entity", list_entry: "KESTREL PETROCHEM TRADING FZE", list: "OFAC_SDN", similarity: 1, status: "open", list_country: "AE" }] },
      proposal: { decision: "decline_review", human_required: true, requested_usd: 300_000, higher_limit_note: false, macro_haircut_applied: false, reason_codes: ["SANCTIONS_MATCH"] } });
    expect(s.headline).toBe("Decline for review: sanctions match");
    expect(s.text).toContain("Open: Kestrel Petrochem Trading FZE ~ KESTREL PETROCHEM TRADING FZE on the OFAC_SDN list (similarity 1, listed country AE)");
  });
});
