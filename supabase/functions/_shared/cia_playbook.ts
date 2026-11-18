/**
 * What CIA may suggest as next steps, and what data it can and cannot see.
 *
 * Answers to advice questions ("should we extend terms?", "do we need collateral?")
 * end with "Suggested next steps" drawn from this playbook:
 *   - in_app:  steps the credit team takes in CreditPilot (a page or an action exists)
 *   - outside: standard credit steps taken outside the app (ask the customer for accounts…)
 * Data CreditPilot does not track yet (collateral, guarantees, credit insurance, bank
 * data…) is listed as a capability with status "not_tracked": CIA mentions it only when
 * the user asks about it, in one plain clause. When the data arrives (a new connector,
 * data the company adds, a bank integration), set `available` for it here and its steps
 * move into the playbook automatically: nothing else in CIA changes.
 */

export type StepTier = "in_app" | "outside";

export interface PlaybookStep {
  key: string;
  tier: StepTier;
  /** The step, as CIA should phrase it. */
  text: string;
  /** When it fits, for the model. */
  when: string;
  /** The capability it needs; absent = always available. */
  needs?: string;
}

export interface Capability {
  key: string;
  label: string;
  /** How it will arrive: the connector key (connectors.ts), a company upload, or a bank feed. */
  arrives_by: string;
  /** True once the data is in CreditPilot. Driven by `capabilityStatus`. */
  available: boolean;
}

/** Data CreditPilot does not hold today. Each one unlocks steps when `available`. */
export const CAPABILITIES: Capability[] = [
  { key: "collateral", label: "collateral and security held", arrives_by: "entered by the credit team on the customer (planned)", available: false },
  { key: "guarantees", label: "parent or personal guarantees", arrives_by: "entered by the credit team on the customer (planned)", available: false },
  { key: "letters_of_credit", label: "letters of credit and bank guarantees", arrives_by: "bank integration (planned)", available: false },
  { key: "credit_insurance", label: "credit insurance cover per customer", arrives_by: "insurer connector, e.g. Allianz Trade or Coface (planned)", available: false },
  { key: "bank_data", label: "bank account and cash-flow data", arrives_by: "bank integration (planned)", available: false },
  { key: "management_accounts", label: "management accounts and documents the customer sends", arrives_by: "uploaded by the company on the customer (planned)", available: false },
  { key: "erp_orders", label: "open orders and shipments not yet invoiced", arrives_by: "ERP connector (planned)", available: false },
];

export const PLAYBOOK: PlaybookStep[] = [
  // In CreditPilot
  { key: "review_customer", tier: "in_app", text: "Open the customer's page to review score, limit, invoices and payment history together", when: "any decision about one customer" },
  { key: "pending_action", tier: "in_app", text: "Approve or reject the proposed action waiting on the Actions page", when: "a proposed action for this customer is waiting" },
  { key: "adjust_limit", tier: "in_app", text: "Lower (or hold) the credit limit until the overdue balance is cleared", when: "utilization is high, invoices are overdue or payments are getting worse" },
  { key: "watch_events", tier: "in_app", text: "Watch the customer's credit events (news, SEC filings, score changes) before deciding", when: "recent negative events, or the score changed" },
  { key: "collect_overdue", tier: "in_app", text: "Chase the overdue invoices shown on AR Aging", when: "invoices are past due" },
  // Outside the app: standard trade-credit practice
  { key: "request_financials", tier: "outside", text: "Ask the customer for its latest annual accounts (and interim figures if the year end is old), then re-score", when: "no financial statements on file, or they are out of date or due soon; also before raising a limit or extending terms on a mid or low score" },
  { key: "shorter_terms", tier: "outside", text: "Keep or shorten payment terms rather than extend them until payments improve", when: "a request to extend terms while payments are late or the score is mid or low" },
  { key: "call_customer", tier: "outside", text: "Call the customer's finance contact about the late payments and agree a payment plan", when: "payments are getting worse or invoices are well past due" },
  { key: "staged_increase", tier: "outside", text: "Raise the limit in steps and review after a few months of on-time payment", when: "a limit increase for a customer with a good score and good payments" },

  // Unlocked by data CreditPilot does not track yet
  { key: "security_if_needed", tier: "in_app", text: "Record the security held (a guarantee, a letter of credit or a deposit) and weigh it against the exposure", when: "a low score with high exposure", needs: "collateral" },
  { key: "check_collateral", tier: "in_app", text: "Check the collateral held against the exposure on the customer's page", when: "high exposure or a low score", needs: "collateral" },
  { key: "check_insurance", tier: "in_app", text: "Check the credit insurance cover against the exposure", when: "exposure above the insured limit", needs: "credit_insurance" },
  { key: "check_bank", tier: "in_app", text: "Review the customer's bank and cash-flow data", when: "doubt about liquidity", needs: "bank_data" },
];

/** Capabilities with their status. `has` answers "is this data in CreditPilot?" (a connector set, a table filled). */
export function capabilityStatus(has: (key: string) => boolean = () => false): Capability[] {
  return CAPABILITIES.map((c) => ({ ...c, available: c.available || has(c.key) }));
}

/** Steps CIA may suggest now: those whose data exists. */
export function availableSteps(caps: Capability[]): PlaybookStep[] {
  const ok = new Set(caps.filter((c) => c.available).map((c) => c.key));
  return PLAYBOOK.filter((s) => !s.needs || ok.has(s.needs));
}

/** The context section CIA reads. */
export function playbookBlock(caps: Capability[]): string {
  const steps = availableSteps(caps);
  const line = (s: PlaybookStep) => `- ${s.text} — when: ${s.when}`;
  const missing = caps.filter((c) => !c.available);
  return [
    "## NEXT STEPS PLAYBOOK (for the Suggested next steps section of advice answers; pick the 2–3 that fit the facts, in CreditPilot first)",
    "In CreditPilot:",
    ...steps.filter((s) => s.tier === "in_app").map(line),
    "Outside CreditPilot (standard credit practice):",
    ...steps.filter((s) => s.tier === "outside").map(line),
    missing.length
      ? `Not tracked in CreditPilot yet (mention only if the user asks about it, in one plain clause such as "CreditPilot doesn't track collateral yet"; never ask the user for it): ${missing.map((c) => c.label).join("; ")}.`
      : "",
  ].filter(Boolean).join("\n");
}

/** What CIA can answer, for the follow-up question generator. */
export const ANSWERABLE_TOPICS =
  "credit scores and their source, credit limits, exposure and utilization, open invoices and AR aging, payment history and payment trends, " +
  "credit events (news, SEC filings, industry, country and FX), proposed actions waiting for approval, how old a customer's financial statements are, " +
  "exposure by sector, country and currency";

/** Is this an advice question (a decision or a course of action), as opposed to a lookup? */
export function isAdviceQuestion(q: string): boolean {
  return /\b(should|shall|can we|could we|do we need|would you|recommend|advise|advice|what (?:should|would|do) (?:i|we)|next step|extend|increase|raise|lower|reduce|approve|decline|reject|terms?|collateral|guarantees?|security|insur(?:ance|ed)|letters? of credit|bank (?:data|statements?)|safe to|ok to|worth|worried|risky)\b/i.test(q);
}
