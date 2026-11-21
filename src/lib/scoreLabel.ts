/**
 * CreditPilot's one score scale, read from the same file the agents and the CIA use
 * (supabase/functions/_shared/score_scale.ts), so the screens can never drift from them.
 * Onboarding stores the label's key as `band`; screens show the label.
 */
import { SCORE_BANDS, scoreBand } from "../../supabase/functions/_shared/score_scale";

/** The label for a stored band key; an application scored before 2026-11-20 shows its old letter band. */
export function bandLabel(band: string | null | undefined): string {
  if (!band) return "n/a";
  return SCORE_BANDS.find((b) => b.key === band)?.label ?? `band ${band}`;
}

/** The label for a 0–100 score on CreditPilot's scale. */
export function scoreLabel(score: number | null | undefined): string | null {
  return scoreBand(score)?.label ?? null;
}

export { SCORE_BANDS, scoreBand };
