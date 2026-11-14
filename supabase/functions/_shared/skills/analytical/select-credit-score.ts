/**
 * @skill select-credit-score
 * @type analytical
 * @description Picks the one score that counts for a company, by the company's source
 *   priority (Settings › onboarding.sources.score_order, e.g. ["keen", "bureau_report"]).
 *   The first source that returns a score wins. Scores are never averaged: a company
 *   that uses Keen gets Keen's score; one that does not gets its next source (D&B,
 *   Creditsafe, an uploaded bureau report, …). Every source tried before the winner is
 *   recorded with its reason, so the memo can say why a fallback was used.
 *   Sources are fetched lazily, in order, so a lower-priority provider is only called
 *   when the ones above it have no score.
 * @input order — source ids in priority order; fetchers — one fetcher per source id
 * @output SelectedScore — the winning source and its result (or none), plus fallbacks
 * @usedBy onboarding pipeline; customer score refresh (planned, same priority list)
 */

export interface ScoreCandidate {
  /** 0–100, higher = safer (already normalised by the adapter). */
  score: number;
  /** The provider's own value, as shown to people (e.g. "BBB+", "Paydex 80"). */
  raw?: string;
  model_version?: string;
  reason_codes?: string[];
  max_credit_recommendation_usd?: number;
  /** Keen's label, 10-K and reasons, carried through untouched. */
  keen?: unknown;
}

export type FetchOutcome = ScoreCandidate | { error: string };
export type ScoreFetcher = () => Promise<FetchOutcome>;

export interface SelectedScore {
  source?: string;
  result?: ScoreCandidate;
  fallbacks: { provider: string; reason: string }[];
  /** True when a score was found but not from the first source in the order. */
  used_fallback: boolean;
}

export async function selectCreditScore(
  order: string[],
  fetchers: Record<string, ScoreFetcher>,
): Promise<SelectedScore> {
  const fallbacks: SelectedScore["fallbacks"] = [];
  for (const source of order) {
    const fetch = fetchers[source];
    if (!fetch) { fallbacks.push({ provider: source, reason: "not_supported" }); continue; }
    let r: FetchOutcome;
    try { r = await fetch(); } catch { r = { error: "unavailable" }; }
    if ("error" in r) { fallbacks.push({ provider: source, reason: r.error }); continue; }
    if (typeof r.score !== "number" || !Number.isFinite(r.score)) { fallbacks.push({ provider: source, reason: "invalid_score" }); continue; }
    return { source, result: { ...r, score: Math.max(0, Math.min(100, r.score)) }, fallbacks, used_fallback: source !== order[0] };
  }
  return { fallbacks, used_fallback: false };
}
