/**
 * CreditPilot's one score scale (mirror of supabase/functions/_shared/score_scale.ts).
 * Onboarding stores the label's key as `band`; screens show the label.
 */
const LABELS: Record<string, string> = {
  very_strong: "Very strong", strong: "Strong", adequate: "Adequate",
  watch: "Watch", elevated: "Elevated risk", high_risk: "High risk",
};

/** The label for a stored band key; an application scored before 2026-11-20 shows its old letter band. */
export function bandLabel(band: string | null | undefined): string {
  if (!band) return "n/a";
  return LABELS[band] ?? `band ${band}`;
}

/** The label for a 0–100 score on CreditPilot's scale. */
export function scoreLabel(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  return score >= 85 ? "Very strong" : score >= 70 ? "Strong" : score >= 55 ? "Adequate"
    : score >= 40 ? "Watch" : score >= 25 ? "Elevated risk" : "High risk";
}
