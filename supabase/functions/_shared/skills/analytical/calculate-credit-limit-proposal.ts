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
    current_exposure = 0,
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

  const k = (usd: number) => `$${Math.round(usd / 1000).toLocaleString("en-US")}k`;
  const onTime = `${Math.round(on_time_rate * 100)}%`;
  if (inDistress && highOverdue) {
    reductionFactor = is_strategic_account ? 0.40 : 0.50;
    rationale = `High risk score (${credit_score}) and ${k(days_over_90)} more than 90 days overdue.`;
  } else if (inDistress && highUtil) {
    reductionFactor = is_strategic_account ? 0.30 : 0.40;
    rationale = `High risk score (${credit_score}) and ${utilization_pct}% of the limit in use.`;
  } else if (criticalUtil && highOverdue) {
    reductionFactor = is_strategic_account ? 0.25 : 0.35;
    rationale = `${utilization_pct}% of the limit in use and ${k(days_over_90)} more than 90 days overdue.`;
  } else if (highUtil && highOverdue) {
    reductionFactor = is_strategic_account ? 0.20 : 0.30;
    rationale = `${utilization_pct}% of the limit in use and ${k(days_over_90)} more than 90 days overdue.`;
  } else if (inGrey && highOverdue && on_time_rate < 0.7) {
    reductionFactor = 0.25;
    rationale = `Elevated risk score (${credit_score}), paid on time ${onTime} of the time, and an overdue balance.`;
  } else if (criticalUtil && (inGrey || inDistress || on_time_rate < 0.5)) {
    // Early warning: critically high limit use with a weak score or poor payment record,
    // before anything is 90 days overdue (F4: Atlas Precision once fell through every branch).
    reductionFactor = is_strategic_account ? 0.15 : 0.20;
    rationale = `${utilization_pct}% of the limit in use with ${(inGrey || inDistress) ? `a weak score (${credit_score})` : `a poor payment record (on time ${onTime} of the time)`}; nothing is 90 days overdue yet, so this is an early-warning cut.`;
  } else if (inDistress) {
    // Policy (founder, 2026-11-21): a High risk score always gets a proposal, whatever the
    // limit use: the limit comes down to what is owed plus the policy's headroom.
    const target = Math.ceil((current_exposure * (1 + rules.high_risk_headroom_pct / 100)) / 5000) * 5000;
    if (target < current_limit) {
      reductionFactor = 1 - target / current_limit;
      rationale = `High risk score (${credit_score}). The policy stops new credit at High risk, so the limit comes down to what the customer owes${rules.high_risk_headroom_pct ? ` plus ${rules.high_risk_headroom_pct}%` : ""}.`;
    }
  }

  // The policy's ceiling on any single cut (a customer group can set a lower one).
  if (reductionFactor > rules.max_reduction_pct / 100) {
    reductionFactor = rules.max_reduction_pct / 100;
    rationale += ` The cut is held to the policy's largest single cut, ${rules.max_reduction_pct}%.`;
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
    rationale += ` The cut is capped at the policy's $${(maxReductionUsd / 1_000_000).toFixed(1)}M (it would otherwise have been $${Math.round(uncappedReductionUsd).toLocaleString()}).`;
  }

  return { proposed_limit, reduction_pct, action: "reduce", rationale };
}
