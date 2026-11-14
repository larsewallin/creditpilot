/**
 * @skill score-refresh
 * @type analytical
 * @description Which customers the Credit Rating agent re-scores from Keen, and what it writes.
 *   Production only (the demo keeps its seeded scores, so its events and actions never shift).
 *   A customer is re-scored when Keen may replace its current score (Keen is in the company's
 *   score order at or above the customer's current source; a typed-in provider ranked above
 *   Keen is kept) and it is due: never checked, last checked over 30 days ago, or a 10-K filed
 *   since. Previous/current scores move only when the score changes, so the agent reports each
 *   change once; the check date and the financial year end move every time.
 * @usedBy credit-rating-agent
 */

export const REFRESH_DAYS = 30;
const DAY = 86_400_000;

export interface RefreshCustomer {
  id: string;
  credit_rating_score: number | null;
  credit_rating_source: string | null;
  credit_rating_updated_at: string | null;
  credit_rating_checked_at: string | null;
}

/** May Keen replace this customer's score, given the company's score order? */
export function keenMayReplace(currentSource: string | null, order: string[]): boolean {
  const keen = order.indexOf("keen");
  if (keen < 0) return false;
  if (!currentSource) return true;
  const cur = order.indexOf(currentSource);
  return cur < 0 || cur >= keen;
}

/** Due for a re-score: never checked, checked over REFRESH_DAYS ago, or a 10-K filed since. */
export function refreshDue(c: RefreshCustomer, now: Date, latest10kFiled?: string | null): boolean {
  const checked = c.credit_rating_checked_at ?? c.credit_rating_updated_at;
  if (!checked) return true;
  const t = Date.parse(checked);
  if (now.getTime() - t > REFRESH_DAYS * DAY) return true;
  return !!latest10kFiled && Date.parse(latest10kFiled) > t;
}

export interface KeenScoreLike { score: number; label?: string; as_of?: string; from: "sec_10k" | "statements" }

/** The customers row update for a Keen score. */
export function scoreUpdate(c: RefreshCustomer, k: KeenScoreLike, now: Date): Record<string, unknown> {
  const score = Math.round(k.score);
  const base: Record<string, unknown> = {
    credit_rating_checked_at: now.toISOString(),
    ...(k.as_of ? { financials_fye: k.as_of.slice(0, 10), financials_source: k.from } : {}),
  };
  const changed = c.credit_rating_score === null || Math.round(Number(c.credit_rating_score)) !== score || c.credit_rating_source !== "keen";
  if (!changed) return base;
  return {
    ...base,
    credit_rating_previous_score: c.credit_rating_score,
    credit_rating_score: score,
    credit_rating_source: "keen",
    credit_rating_raw: k.label ? `${score} ${k.label}` : String(score),
    credit_rating_updated_at: now.toISOString(),
  };
}
