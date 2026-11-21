/** SEC filing risk-signal codes in plain words, for event text and the screens (one list for both). */
export const SEC_SIGNAL_LABEL: Record<string, string> = {
  going_concern_warning: "doubt about its ability to continue (going concern)",
  "cash_runway_<3_quarters": "cash for under three quarters",
  covenant_waiver: "a covenant waiver",
  ceo_departure: "its CEO leaving",
  strategic_alternatives_sought: "a search for strategic alternatives (a possible sale or restructuring)",
  revenue_miss: "revenue below expectations",
  cash_decline: "falling cash",
  declining_cash_position: "falling cash",
  lender_waiver_discussions: "talks with lenders about waivers",
  workforce_reduction: "job cuts",
};

export const secSignalLabel = (code: string) => SEC_SIGNAL_LABEL[code] ?? code.replace(/_/g, " ");

/** "Risk signals in 10-K (2025-03-27): going_concern_warning, …" → plain words. */
export function plainSecText(text: string): string {
  return text.replace(/\b(going_concern_warning|cash_runway_<3_quarters|covenant_waiver|ceo_departure|strategic_alternatives_sought|revenue_miss|cash_decline|declining_cash_position|lender_waiver_discussions|workforce_reduction)\b/g, (m) => secSignalLabel(m))
    .replace(/^Risk signals in /, "Warning signs in its ");
}
