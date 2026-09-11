/**
 * @skill aggregate-credit-scores
 * @type analytical
 * @description Combines multiple normalised credit scores into one authoritative 0–100 score.
 *   Higher = lower risk. All providers treated equally — simple average, no weighting.
 *   Empty input or all signals filtered out → final_score null, interpretation 'NR'.
 *   Never throws.
 *
 *   Design decisions:
 *   - No provider weights: avoids implicit ranking of rating agencies
 *   - NR (No Rating) rather than a default score — unknown risk should not be
 *     assumed as average (50); callers must handle null explicitly
 *   - source_providers lists which providers contributed (e.g. ['sp_fitch', 'coface'])
 *
 * @input CreditSignal[] — any mix of providers
 * @output AggregatedScore — simple-average final score, source breakdown, source_providers list
 * @usedBy cia-agent (context formatting)
 */

import {
  normaliseCreditSignal,
  CreditSignal,
} from "./normalise-credit-signal.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AggregatedScore {
  final_score: number | null;                       // null = No Rating (no valid sources)
  source_count: number;
  source_providers: string[];                       // e.g. ['sp_fitch', 'coface']
  interpretation: "very_safe" | "safe" | "watch" | "concern" | "high_risk" | "NR";
  sources: {
    provider: string;
    raw_score: string | number;
    normalised_score: number;
  }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toInterpretation(score: number): Exclude<AggregatedScore["interpretation"], "NR"> {
  if (score >= 80) return "very_safe";
  if (score >= 60) return "safe";
  if (score >= 40) return "watch";
  if (score >= 20) return "concern";
  return "high_risk";
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function aggregateCreditScores(signals: CreditSignal[]): AggregatedScore {
  const NR: AggregatedScore = {
    final_score: null,
    source_count: 0,
    source_providers: [],
    interpretation: "NR",
    sources: [],
  };

  if (!signals || signals.length === 0) return NR;

  let scoreSum = 0;
  const sources: AggregatedScore["sources"] = [];

  for (const signal of signals) {
    const norm = normaliseCreditSignal(signal);

    // Skip if normalisation fell back due to unrecognised input value
    // (confidence dropped to 'low' when the original confidence was 'high' or 'medium')
    if (norm.confidence === "low" && signal.confidence !== "low") {
      continue;
    }

    scoreSum += norm.normalised_score;

    sources.push({
      provider: signal.source,
      raw_score: signal.raw_value,
      normalised_score: norm.normalised_score,
    });
  }

  if (sources.length === 0) return NR;

  const final_score = round1(scoreSum / sources.length);
  const source_providers = sources.map((s) => s.provider);

  return {
    final_score,
    source_count: sources.length,
    source_providers,
    interpretation: toInterpretation(final_score),
    sources,
  };
}
