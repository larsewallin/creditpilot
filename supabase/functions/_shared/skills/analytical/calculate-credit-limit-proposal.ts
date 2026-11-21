/**
 * @skill calculate-credit-limit-proposal
 * @type analytical
 * @description Proposes a revised credit limit based on utilization, overdue balance,
 *   normalised credit score (0–100), and whether the customer is a strategic account.
 *   Each severity tier below sets its own explicit reduction % (20-50%) — there is no
 *   separate generic "minimum reduction" floor layered on top (removed 2026-10-01: it was
 *   redundant with the tiers' own values and, combined with a flat %, produced wildly
 *   different dollar impacts across account sizes).
 *   Strategic accounts receive 10pp latitude on utilization thresholds.
 *   Payment behaviour (on_time_rate) adjusts utilization thresholds broadly:
 *   poor payers trigger action at lower utilization levels.
 *
 *   Credit score thresholds:
 *     < 20  → treat as distress
 *     20–40 → treat as grey / concern
 *     > 40  → treat as safe
 *     null  → use utilization and payment behaviour only
 *
 *   Dollar cap (added 2026-10-01, see F4 in CreditPilot_Deferred_Backlog.md): the dollar
 *   amount of any single reduction is capped at MAX_REDUCTION_USD regardless of the
 *   severity-tier %. Rationale: a flat % reduction scales reduction dollars with account
 *   size, so the same 25% cut is a small adjustment on a $150K account but a multi-
 *   million-dollar one on an $8M account. The cap only binds for the portfolio's largest
 *   accounts; typical/median accounts are governed entirely by the % tier below it.
 *   Kept as a single named constant (not inlined) so a future per-company Settings page
 *   (see backlog D5) can read/override it per account instead of this fixed value.
 *
 * @input CreditLimitInput — current limit, exposure metrics, financial health indicators
 * @output CreditLimitProposal — proposed limit, reduction %, action, and rationale
 * @usedBy ar-aging-agent, credit-limit-review-agent (planned)
 */

// Absolute ceiling on a single reduction's dollar impact, regardless of the %-based
// severity tier. See the @description block above and F4 in the deferred backlog for the
// full rationale and the portfolio data (median $1.5M, p90 $4M, max $8M) it was sized against.
import { POLICY_DEFAULTS, type CreditPolicy } from "../../policy/defaults.ts";
export const MAX_REDUCTION_USD = POLICY_DEFAULTS.limit_review.max_reduction_usd;

export interface CreditLimitInput {
  current_limit: number;
  current_exposure: number;
  days_over_90: number;
  utilization_pct: number;          // 0–100
  credit_score?: number | null;     // 0–100 normalised score; null = unavailable
  is_strategic_account?: boolean;
  on_time_rate?: number;            // 0–1, from payment history
}

export interface CreditLimitProposal {
  proposed_limit: number;
  reduction_pct: number;            // effective percentage points reduced (post-cap); 0 = no action
  action: "reduce" | "no_action";
  rationale: string;
}

export function calculateCreditLimitProposal(
  input: CreditLimitInput,
  rules: CreditPolicy["limit_review"] = POLICY_DEFAULTS.limit_review,
): CreditLimitProposal {
  const maxReductionUsd = rules.max_reduction_usd;
  const {
    current_limit,
    days_over_90,
    utilization_pct,
    credit_score = null,
    is_strategic_account = false,
    on_time_rate = 1,
  } = input;

  if (!current_limit || current_limit <= 0) {
    return {
      proposed_limit: 0,
      reduction_pct: 0,
      action: "no_action",
      rationale: "No credit limit set.",
    };
  }

  // Map normalised credit score to risk category
  const inDistress = credit_score !== null && credit_score < rules.distress_score_below;
  const inGrey = credit_score !== null && credit_score >= rules.distress_score_below && credit_score <= rules.concern_score_up_to;
  const highOverdue = days_over_90 > current_limit * (rules.high_overdue_pct_of_limit / 100);

  // Payment behaviour adjusts utilization thresholds
  // Poor payers trigger action at lower utilization levels
  let paymentPenalty = 0;
  if (on_time_rate < 0.50) paymentPenalty = 15;       // seriously struggling
  else if (on_time_rate < 0.70) paymentPenalty = 10;  // below acceptable
  else if (on_time_rate < 0.85) paymentPenalty = 5;   // slightly below ideal

  // Strategic accounts get 10pp latitude — thresholds are higher before action triggers
  const latitude = is_strategic_account ? rules.strategic_latitude_pct : 0;
  const highUtilThreshold = rules.high_utilization_pct + latitude - paymentPenalty;
  const criticalUtilThreshold = rules.critical_utilization_pct + latitude - paymentPenalty;
  const highUtil = utilization_pct > highUtilThreshold;
  const criticalUtil = utilization_pct > criticalUtilThreshold;

  let reductionFactor = 0;
  let rationale = "";

  if (inDistress && highOverdue) {
    reductionFactor = is_strategic_account ? 0.40 : 0.50;
    rationale = `Customer credit score in distress range (${credit_score}) with $${(days_over_90 / 1000).toFixed(0)}K over 90 days past due. Significant limit reduction warranted.`;
  } else if (inDistress && highUtil) {
    reductionFactor = is_strategic_account ? 0.30 : 0.40;
    rationale = `Distress credit score (${credit_score}) with ${utilization_pct}% utilization. Limit reduction to protect exposure.`;
  } else if (criticalUtil && highOverdue) {
    reductionFactor = is_strategic_account ? 0.25 : 0.35;
    rationale = `Critical utilization (${utilization_pct}%) combined with $${(days_over_90 / 1000).toFixed(0)}K over 90 days.`;
  } else if (highUtil && highOverdue) {
    reductionFactor = is_strategic_account ? 0.20 : 0.30;
    rationale = `High utilization (${utilization_pct}%) with $${(days_over_90 / 1000).toFixed(0)}K overdue balance.`;
  } else if (inGrey && highOverdue && on_time_rate < 0.7) {
    reductionFactor = 0.25;
    rationale = `Credit score in concern range (${credit_score}) with declining payment behaviour (on-time rate ${Math.round(on_time_rate * 100)}%) and overdue balance.`;
  } else if (criticalUtil && (inGrey || inDistress || on_time_rate < 0.5)) {
    // No aged overdue balance yet (otherwise an earlier branch would have fired) — this is
    // a warning-tier reduction for a customer running critically high utilization with a
    // weak score or poor payment history, before it becomes an overdue problem. See F4 in
    // the deferred backlog: previously no branch covered this case at all (e.g. Atlas
    // Precision Manufacturing: 109% utilization, score 32, on-time rate 0.24, zero
    // days_over_90 → fell through every branch and got no_action).
    reductionFactor = is_strategic_account ? 0.15 : 0.20;
    rationale = `Critical utilization (${utilization_pct}%) with ${(inGrey || inDistress) ? `a weak credit score (${credit_score})` : "a poor on-time payment rate"} (on-time rate ${Math.round(on_time_rate * 100)}%), no aged overdue balance yet. Early warning-tier reduction.`;
  }

  if (reductionFactor === 0) {
    return {
      proposed_limit: current_limit,
      reduction_pct: 0,
      action: "no_action",
      rationale: "No credit limit reduction warranted at this time.",
    };
  }

  // Cap the dollar amount of the reduction — see MAX_REDUCTION_USD and the @description
  // block above. The severity tier above still decides *whether* and *how aggressively*
  // to cut; this only bounds the absolute dollar impact for the portfolio's largest accounts.
  const uncappedReductionUsd = current_limit * reductionFactor;
  const cappedReductionUsd = Math.min(uncappedReductionUsd, maxReductionUsd);
  const wasCapped = cappedReductionUsd < uncappedReductionUsd;

  const proposed_limit = Math.round(current_limit - cappedReductionUsd);
  const reduction_pct = Math.round((cappedReductionUsd / current_limit) * 100);

  if (wasCapped) {
    rationale += ` Reduction capped at $${(maxReductionUsd / 1_000_000).toFixed(1)}M (would otherwise have been $${Math.round(uncappedReductionUsd).toLocaleString()}).`;
  }

  return { proposed_limit, reduction_pct, action: "reduce", rationale };
}
