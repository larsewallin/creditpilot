/**
 * After a person rejects a proposed limit cut, the agents stay quiet about that customer for
 * a while (founder, 2026-11-21: 30 days), unless it gets worse. "Worse" here means the new
 * proposal cuts deeper than the rejected one by at least policy.limit_review.
 * reopen_extra_cut_pct points of the limit. Pure: the caller passes the rejected rows.
 */
import type { CreditPolicy } from "./defaults.ts";

export interface RejectedProposal { current_value: number | null; proposed_value: number | null; reviewed_at: string | null }

/** A reason to stay quiet, or null when the new proposal should be made. */
export function quietAfterRejection(
  rejected: RejectedProposal[],
  proposal: { current_value: number; proposed_value: number },
  rules: CreditPolicy["limit_review"],
  now = new Date(),
): string | null {
  const since = now.getTime() - rules.rejection_quiet_days * 86_400_000;
  const cutPct = (c: number, p: number) => (c > 0 ? (1 - p / c) * 100 : 0);
  const newCut = cutPct(proposal.current_value, proposal.proposed_value);
  for (const r of rejected) {
    if (!r.reviewed_at || Date.parse(r.reviewed_at) < since) continue;
    const oldCut = cutPct(Number(r.current_value) || 0, Number(r.proposed_value) || 0);
    if (newCut < oldCut + rules.reopen_extra_cut_pct) {
      return `a similar cut was rejected on ${r.reviewed_at.slice(0, 10)}; quiet for ${rules.rejection_quiet_days} days unless it gets worse`;
    }
  }
  return null;
}
