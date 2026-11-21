/**
 * How many trade references the company's policy asks of an applicant (onboarding.template.trade_references).
 * Founder, 2026-11-20: a large company needs none; the number depends on size and score.
 * Size is the latest revenue in USD; unknown revenue counts as small. Strong or better asks fewer.
 */
import type { OnboardingSettings } from "./types.ts";
import type { ScoreKey } from "../score_scale.ts";

export function requiredTradeReferences(
  rule: OnboardingSettings["template"]["trade_references"],
  revenueUsd: number | undefined,
  band: ScoreKey | null | undefined,
): number {
  const r = revenueUsd ?? 0;
  const base = r >= rule.large_revenue_usd ? rule.large : r >= rule.mid_revenue_usd ? rule.mid : rule.small;
  const strong = band === "very_strong" || band === "strong";
  return Math.max(0, base - (strong ? rule.fewer_if_strong_or_better : 0));
}
