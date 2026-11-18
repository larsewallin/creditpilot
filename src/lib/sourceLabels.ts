/** Plain-language labels for CIA's sources ("Payments · Overdue invoices"), never internal names. */
import { eventLabel } from "@/lib/eventLabels";

interface SourceLike { event_type?: string | null; source_type?: string }

const AGENT_NAMES: [RegExp, string][] = [
  [/ar[_-]aging/, "AR aging"], [/payment/, "Payments"], [/news/, "News"], [/sec/, "SEC filings"],
  [/credit[_-]rating|score/, "Credit score"], [/industry/, "Industry"], [/country/, "Country"], [/fx/, "FX"],
  [/concentration/, "Concentration"], [/cia/, "Assistant"], [/risk/, "Risk"],
];
const RECORD_NAMES: Record<string, string> = {
  customers: "Customer record", invoices: "Invoices", payment_transactions: "Payment history",
  sec_filings: "SEC filing", negative_news: "News", credit_events: "Credit event",
};

export function agentLabel(agent: string | null | undefined, sourceType?: string) {
  if (!agent) return sourceType === "invoices" ? "AR aging" : sourceType === "payment_transactions" ? "Payments" : "Customer";
  return AGENT_NAMES.find(([re]) => re.test(agent))?.[1] ?? agent.replace(/_agent$/, "").replace(/_/g, " ");
}

/** What the source is, in plain words: "Overdue invoices", "Customer record". */
export function sourceLabel(s: SourceLike) {
  if (s.event_type) return eventLabel(s.event_type);
  return RECORD_NAMES[s.source_type ?? ""] ?? "Record";
}
