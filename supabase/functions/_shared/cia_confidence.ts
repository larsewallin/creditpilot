// The CIA answer's confidence, from its citations (founder 2026-11-24: no second model call).

/** The answer's confidence from what its citations show, in code (no second model call). */
export function gradeFromCitations(a: { cited: number; verified: number; web: number; computedList: boolean; noData: boolean; hasFigures: boolean }): { confidence: string; confidence_reason: string } {
  if (a.noData) return { confidence: "Low", confidence_reason: "CreditPilot's data does not cover this question." };
  if (a.cited > a.verified) return { confidence: "Medium", confidence_reason: "Some statements could not be matched to a record in CreditPilot's data." };
  if (a.computedList) return { confidence: "High", confidence_reason: "The list is computed in code from CreditPilot's data, not written by the model." };
  if (a.verified > 0) return { confidence: "High", confidence_reason: `Every cited figure links to a record in CreditPilot's data${a.web ? " or a web page" : ""}.` };
  if (a.web > 0) return { confidence: "Medium", confidence_reason: "This rests on the cited web pages, not on CreditPilot's data." };
  return a.hasFigures
    ? { confidence: "Medium", confidence_reason: "The figures are not linked to a record; check them on the pages." }
    : { confidence: "High", confidence_reason: "A general answer from CreditPilot's data and policy." };
}
