/**
 * @skill detect-rating-change
 * @type analytical
 * @description Detects credit rating upgrades and downgrades by comparing
 *   a current normalised score (0–100) against the previous score.
 *   Returns null type when the change is not significant (< 5 points).
 *
 *   Downgrade severity thresholds (absolute delta):
 *     ≥ 30 → critical
 *     ≥ 20 → high
 *     ≥ 10 → medium   (action_required = true)
 *     ≥  5 → low      (action_required = false)
 *     <  5 → no significant change (type = null)
 *
 *   Upgrades are always: severity = 'info', action_required = false.
 *
 * @input previousScore: number, currentScore: number — both on 0–100 scale
 * @output RatingChangeResult — type, severity, delta, action_required
 * @usedBy cia-agent, ar-aging-agent
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RatingChangeResult {
  type: "CREDIT_RATING_DOWNGRADE" | "CREDIT_RATING_UPGRADE" | null;
  severity: "critical" | "high" | "medium" | "low" | "info" | null;
  previous_score: number;
  current_score: number;
  delta: number;          // negative = downgrade, positive = upgrade
  action_required: boolean;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function detectRatingChange(
  previousScore: number,
  currentScore: number
): RatingChangeResult {
  const delta = currentScore - previousScore;
  const absDelta = Math.abs(delta);

  const base: Pick<RatingChangeResult, "previous_score" | "current_score" | "delta"> = {
    previous_score: previousScore,
    current_score: currentScore,
    delta,
  };

  // No significant change
  if (absDelta < 5) {
    return { ...base, type: null, severity: null, action_required: false };
  }

  if (delta < 0) {
    // Downgrade
    const severity: RatingChangeResult["severity"] =
      absDelta >= 30 ? "critical"
      : absDelta >= 20 ? "high"
      : absDelta >= 10 ? "medium"
      : "low";

    return {
      ...base,
      type: "CREDIT_RATING_DOWNGRADE",
      severity,
      action_required: absDelta >= 10,
    };
  }

  // Upgrade — informational only
  return {
    ...base,
    type: "CREDIT_RATING_UPGRADE",
    severity: "info",
    action_required: false,
  };
}
