import { describe, expect, it } from "vitest";
import { UNANSWERABLE_FOLLOW_UP } from "../cia_followups";

// Follow-ups the CIA suggested and then could not answer (follow-up audits, 2026-11-24): dropped.
const DROP = [
  "When will the pending limit reduction for Marlow Industrial Castings be approved?",
  "What is the payment history trend for invoices denominated in EUR and GBP?",
  "What triggered Tidewell Water Systems Inc's credit score improvement from 58 to 66?",
  "Has Brightwater filed a reorganization plan or disclosed expected recovery percentage yet?",
  "What was Brightwater's credit score trend in the 6 months before the bankruptcy filing?",
  "How has JPY exposure trended over the last 90 days?",
  "When was Brightwater Retail Fixtures Inc's bankruptcy filing date reported?",
  "What is our total AR aging distribution across these three currencies?",
  "What is Marlow Industrial Castings' current credit score breakdown by component?",
];
// Follow-ups it answered well: kept.
const KEEP = [
  "What specific credit events drove Solenne's 23-point score decline?",
  "What is Tidewell Water Systems Inc's current credit limit and utilization percentage?",
  "How late does Carrick pay now compared with before?",
  "Which customers drive the EUR and GBP exposure concentration?",
  "Has Solenne Battery Technologies Inc had any recent credit events or rating changes in CreditPilot?",
  "What is Carrick's payment trend over the last 90 days?",
  "Does Calloway Defense Systems have any open invoices past due?",
  "How much is open in EUR?",
  "What is our total exposure by currency?",
  "Which customers had a score drop in the last 30 days?",
];
describe("UNANSWERABLE_FOLLOW_UP", () => {
  it.each(DROP)("drops %s", (q) => expect(UNANSWERABLE_FOLLOW_UP.test(q)).toBe(true));
  it.each(KEEP)("keeps %s", (q) => expect(UNANSWERABLE_FOLLOW_UP.test(q)).toBe(false));
});
