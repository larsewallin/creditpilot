/**
 * @skill calculate-credit-limit-proposal
 * @type analytical
 * @description Proposes a revised credit limit based on utilization, overdue balance,
 *   normalised credit score (0–100), and whether the customer is a strategic account.
 *   Each severity tier below sets its own explicit reduction % (20-50%) — there is no
 *   separate generic "minimum reduction" floor layered on top (removed 2026-10-01: it was
 *   redundant with the tiers' own values and, combined with a flat %, produced wildly
 *   different dollar impacts across account sizes).
 *   Whether limit use is high is decided once, by assess-composite-risk (founder 2026-11-23:
 *   one limit-use rule): the caller passes its adjusted_threshold as action_threshold_pct.
 *   "Critical" limit use is the policy's critical alert level (utilization.critical_pct).
 *   Strategic accounts (a group) get more room through that group's own base threshold and
 *   smaller reduction tiers.
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
  /** Limit use (%) at which this customer's limit is acted on: assess-composite-risk's adjusted_threshold. */
  action_threshold_pct?: number;
  /** Limit use (%) that is critical: policy utilization.critical_pct. */
  critical_utilization_pct?: number;
  /** Pre-petition (frozen) balance, USD, when the customer is in bankruptcy; absent otherwise. */
  pre_petition_usd?: number | null;
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
  pay: Pick<CreditPolicy["payments"], "watch_on_time_below"> = POLICY_DEFAULTS.payments,
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
    action_threshold_pct = POLICY_DEFAULTS.composite.base_threshold_pct,
    critical_utilization_pct = POLICY_DEFAULTS.utilization.critical_pct,
  } = input;

  if (!current_limit || current_limit <= 0) {
    return {
      proposed_limit: 0,
      reduction_pct: 0,
      action: "no_action",
      rationale: "No credit limit set.",
    };
  }

  // In bankruptcy (founder, 2026-11-21): hold the limit at $0, no new credit, whatever the
  // score or limit use. Not held to the policy's largest-cut limits: a hold is not a trim.
  if (input.pre_petition_usd != null) {
    const owed = Math.round(input.pre_petition_usd);
    return {
      proposed_limit: 0,
      reduction_pct: 100,
      action: "reduce",
      rationale: `In bankruptcy: hold the limit at $0, no new credit. File a claim for the $${owed.toLocaleString("en-US")} owed from before the filing; sell only on cash in advance.`,
    };
  }

  // Map normalised credit score to risk category
  const inDistress = credit_score !== null && credit_score < rules.distress_score_below;
  const inGrey = credit_score !== null && credit_score >= rules.distress_score_below && credit_score <= rules.concern_score_up_to;
  const highOverdue = days_over_90 > current_limit * (rules.high_overdue_pct_of_limit / 100);

  // One limit-use rule: the threshold comes from assess-composite-risk (signals and payment
  // record already lower it there). Critical: at the policy's critical alert level or above it.
  const highUtil = utilization_pct >= action_threshold_pct;
  const criticalUtil = utilization_pct >= Math.max(action_threshold_pct, critical_utilization_pct);
  const watchOnTime = pay.watch_on_time_below;

  let reductionFactor = 0;
  let rationale = "";

  const k = (usd: number) => `$${Math.round(usd / 1000).toLocaleString("en-US")}k`;
  const onTime = `${Math.round(on_time_rate * 100)}%`;
  const use = `${Math.round(utilization_pct)}%`;
  const overLimit = current_exposure > current_limit;
  if (inDistress && highOverdue) {
    reductionFactor = is_strategic_account ? 0.40 : 0.50;
    rationale = `High risk score (${credit_score}) and ${k(days_over_90)} more than 90 days overdue.`;
  } else if (inDistress && highUtil) {
    reductionFactor = is_strategic_account ? 0.30 : 0.40;
    rationale = `High risk score (${credit_score}) and ${use} of the limit in use.`;
  } else if (criticalUtil && highOverdue) {
    reductionFactor = is_strategic_account ? 0.25 : 0.35;
    rationale = `${use} of the limit in use and ${k(days_over_90)} more than 90 days overdue.`;
  } else if (highUtil && highOverdue) {
    reductionFactor = is_strategic_account ? 0.20 : 0.30;
    rationale = `${use} of the limit in use and ${k(days_over_90)} more than 90 days overdue.`;
  } else if (inGrey && highOverdue && on_time_rate < watchOnTime) {
    reductionFactor = 0.25;
    rationale = `Elevated risk score (${credit_score}), paid on time ${onTime} of the time, and an overdue balance.`;
  } else if (highUtil && (inGrey || inDistress || on_time_rate < 0.5)) {
    // Early warning: limit use at the customer's action level with a weak score or poor payment record,
    // before anything is 90 days overdue (F4: Atlas Precision once fell through every branch).
    reductionFactor = is_strategic_account ? 0.15 : 0.20;
    const why = (inGrey || inDistress) ? `a weak score (${credit_score})` : `a poor payment record (on time ${onTime} of the time)`;
    rationale = overLimit
      ? `Over the limit (${use} in use) with ${why}.`
      : `${use} of the limit in use with ${why}; nothing is 90 days overdue yet, so this is an early-warning cut.`;
  } else if (inDistress) {
    // Policy (founder, 2026-11-21): a High risk score always gets a proposal, whatever the
    // limit use: the limit comes down to what is owed plus the policy's headroom.
    const target = Math.ceil((current_exposure * (1 + rules.high_risk_headroom_pct / 100)) / 5000) * 5000;
    if (target < current_limit) {
      reductionFactor = 1 - target / current_limit;
      const owedUsd = `$${Math.round(current_exposure).toLocaleString("en-US")}`;
      rationale = `High risk score (${credit_score}). The policy stops new credit at High risk, so the limit comes down to what the customer owes${rules.high_risk_headroom_pct ? ` plus ${rules.high_risk_headroom_pct}%` : ""} (${owedUsd}, rounded up to the next $5,000).`;
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

  // A new limit below what is owed blocks new orders until the customer pays down: say so
  // (founder 2026-11-23: keep the cut, state the consequence).
  if (proposed_limit < current_exposure) {
    const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
    rationale += ` The new limit is below the ${usd(current_exposure)} owed: no new orders until the balance is under ${usd(proposed_limit)} (${usd(current_exposure - proposed_limit)} to collect first).`;
  }

  return { proposed_limit, reduction_pct, action: "reduce", rationale };
}
