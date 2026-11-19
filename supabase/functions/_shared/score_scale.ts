/**
 * How CreditPilot reads a 0–100 credit score (founder, 2026-11-19: "58/100 is good; it is not a
 * reason to reduce a limit"). The bands are Keen's published labels, on a short-term trade-credit
 * horizon (receivables due within a year), not a rating agency's 3–5-year view.
 */
export interface ScoreBand { min: number; label: string; meaning: string }

export const SCORE_BANDS: ScoreBand[] = [
  { min: 85, label: "Very strong", meaning: "very low short-term risk" },
  { min: 70, label: "Strong", meaning: "low short-term risk" },
  { min: 55, label: "Adequate", meaning: "acceptable risk for normal trade terms; not by itself a reason to cut a limit" },
  { min: 40, label: "Watch", meaning: "keep an eye on it; act if payments or other short-term signals weaken" },
  { min: 25, label: "Elevated risk", meaning: "tighter terms or a lower limit are reasonable" },
  { min: 0, label: "High risk", meaning: "high short-term risk; secure or reduce exposure" },
];

export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (score == null || !Number.isFinite(Number(score))) return null;
  return SCORE_BANDS.find((b) => Number(score) >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

/** The rule CIA follows when a score or an agency's outlook comes into an answer. */
export const SCORE_GUIDANCE =
  "Read credit scores on CreditPilot's scale: 85–100 Very strong, 70–84 Strong, 55–69 Adequate, 40–54 Watch, 25–39 Elevated risk, 0–24 High risk (score_label in the data). " +
  "Describe a score only by its label and never call an Adequate or better score risky, weak or a reason to act. " +
  "CreditPilot judges short-term trade credit (receivables due within months): the reasons to lower a limit or tighten terms are short-term signals: slower payments, overdue invoices, high limit use, a falling score, distress events (insolvency, going concern, defaults). " +
  "A rating agency's outlook, watch or long-term rating change reflects a 3–5-year view: mention it as background, never as a reason on its own to reduce a limit. " +
  "When the score is Adequate or better and short-term signals are weak, say the decision rests on those signals, not on the score.";
