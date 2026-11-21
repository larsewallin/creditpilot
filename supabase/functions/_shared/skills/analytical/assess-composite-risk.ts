/**
 * @skill assess-composite-risk
 * @type analytical
 * @description Evaluates composite credit risk by combining AR aging signals, news signals,
 *   SEC signals, and normalised credit score. Adjusts the utilization action threshold
 *   downward based on active negative signals, allowing multi-signal convergence to trigger
 *   earlier intervention than any single signal would alone.
 *   Payment behaviour (on_time_rate) applies an additional penalty to the threshold.
 *
 *   Base threshold: 75% utilization triggers action.
 *   Signal adjustments (cumulative, floor at 40%):
 *     NEWS_EVENT (high or critical severity)         −10pp
 *     GOING_CONCERN                                  −15pp
 *     COVENANT_WAIVER                                −12pp
 *     CEO_DEPARTURE                                  −5pp
 *     CREDIT_RATING_DOWNGRADE                        −10pp
 *     RISK_CHANGE (macro convergence, Risk Agent)    −5pp (2 dimensions) / −10pp (3+)
 *     credit_score < 20 (distress)                   −15pp
 *     credit_score 20–40 (concern)                   −5pp
 *   Payment behaviour adjustments (applied after signal delta):
 *     on_time_rate < 0.50                            −15pp
 *     on_time_rate < 0.70                            −10pp
 *     on_time_rate < 0.85                            −5pp
 *
 *   recommend_action is true when:
 *     utilization_pct >= adjusted_threshold, OR
 *     credit_score < 20 AND at least one signal is active, OR
 *     3+ distinct agents have flagged the same customer
 *
 *   Severity (weighted by agent count AND active signal severity):
 *     3+ agents, OR 2+ agents with critical signal → critical
 *     2+ agents, OR 1 agent with critical signal   → high
 *     1 agent + active high-severity signal         → high
 *     1 agent + score < 20 (distress)               → high
 *     1 agent only                                  → medium
 *     no signals                                    → info
 *
 * @input CompositeRiskInput — includes optional on_time_rate and active_signal_severities
 * @output CompositeRiskResult
 * @usedBy cia-agent (briefing mode, Step 6b)
 */

import { POLICY_DEFAULTS, type CreditPolicy } from "../../policy/defaults.ts";

export interface CompositeRiskInput {
  utilization_pct: number;
  credit_score?: number | null;
  /** Event types currently active for this customer (from credit_events.event_type) */
  active_event_types: string[];
  /** Severity values from active credit_events ('critical', 'high', 'medium', 'low', 'info') */
  active_signal_severities?: string[];
  /** Unique source agents that have flagged this customer in the current run */
  agents_flagging: string[];
  /** Payment on-time rate 0–1; adjusts threshold downward for poor payers */
  on_time_rate?: number;
  /** Distinct macro dimensions (country / industry / currency) converging on this customer, from a RISK_CHANGE event */
  macro_dimension_count?: number;
}

export interface CompositeRiskResult {
  adjusted_threshold: number;
  recommend_action: boolean;
  severity: "critical" | "high" | "medium" | "info";
  rationale: string;
  adjustments: string[];
}

export function assessCompositeRisk(
  input: CompositeRiskInput,
  rules: CreditPolicy["composite"] = POLICY_DEFAULTS.composite,
  scale: Pick<CreditPolicy["limit_review"], "distress_score_below" | "concern_score_up_to"> = POLICY_DEFAULTS.limit_review,
): CompositeRiskResult {
  const BASE_THRESHOLD = rules.base_threshold_pct;
  const THRESHOLD_FLOOR = rules.floor_pct;
  const DISTRESS = scale.distress_score_below, CONCERN = scale.concern_score_up_to;
  const {
    utilization_pct,
    credit_score = null,
    active_event_types,
    active_signal_severities,
    agents_flagging,
    on_time_rate,
    macro_dimension_count,
  } = input;

  const adjustments: string[] = [];
  let delta = 0;

  // Signal-driven threshold adjustments
  const hasCriticalSignal = active_signal_severities?.includes("critical") ?? false;
  const hasHighSignal = active_signal_severities?.includes("high") ?? false;

  if (active_event_types.includes("NEWS_EVENT") && (hasCriticalSignal || hasHighSignal)) {
    delta += rules.negative_news_pts;
    adjustments.push(`NEGATIVE_NEWS (−${rules.negative_news_pts}pp)`);
  }

  if (active_event_types.includes("GOING_CONCERN")) {
    delta += rules.going_concern_pts;
    adjustments.push(`GOING_CONCERN (−${rules.going_concern_pts}pp)`);
  }

  if (active_event_types.includes("COVENANT_WAIVER")) {
    delta += rules.covenant_waiver_pts;
    adjustments.push(`COVENANT_WAIVER (−${rules.covenant_waiver_pts}pp)`);
  }

  if (active_event_types.includes("CEO_DEPARTURE")) {
    delta += rules.ceo_departure_pts;
    adjustments.push(`CEO_DEPARTURE (−${rules.ceo_departure_pts}pp)`);
  }

  if (active_event_types.includes("CREDIT_RATING_DOWNGRADE")) {
    delta += rules.score_drop_pts;
    adjustments.push(`CREDIT_RATING_DOWNGRADE (−${rules.score_drop_pts}pp)`);
  }

  if (active_event_types.includes("RISK_CHANGE")) {
    const heavy = (macro_dimension_count ?? 2) >= 3;
    const pts = heavy ? rules.macro_three_dimensions_pts : rules.macro_two_dimensions_pts;
    delta += pts;
    adjustments.push(`MACRO_CONVERGENCE (−${pts}pp)`);
  }

  // Credit score threshold adjustments
  if (credit_score !== null && credit_score < DISTRESS) {
    delta += rules.distress_score_pts;
    adjustments.push(`credit_score distress <${DISTRESS} (−${rules.distress_score_pts}pp)`);
  } else if (credit_score !== null && credit_score >= DISTRESS && credit_score <= CONCERN) {
    delta += rules.concern_score_pts;
    adjustments.push(`credit_score concern ${DISTRESS}–${CONCERN} (−${rules.concern_score_pts}pp)`);
  }

  // Payment behaviour adjusts threshold (same logic as calculate-credit-limit-proposal)
  let paymentPenalty = 0;
  if (on_time_rate !== undefined && on_time_rate !== null) {
    if (on_time_rate < 0.50) { paymentPenalty = 15; adjustments.push("on_time_rate <50% (−15pp)"); }
    else if (on_time_rate < 0.70) { paymentPenalty = 10; adjustments.push("on_time_rate <70% (−10pp)"); }
    else if (on_time_rate < 0.85) { paymentPenalty = 5; adjustments.push("on_time_rate <85% (−5pp)"); }
  }

  const adjusted_threshold = Math.max(THRESHOLD_FLOOR, BASE_THRESHOLD - delta - paymentPenalty);

  // Determine whether action is recommended
  const hasActiveSignals = active_event_types.length > 0;
  const inDistress = credit_score !== null && credit_score < DISTRESS;
  const multiAgent = agents_flagging.length >= 3;

  const recommend_action =
    utilization_pct >= adjusted_threshold ||
    (inDistress && hasActiveSignals) ||
    multiAgent;

  // Determine severity — weighted by agent count AND active signal severity
  let severity: CompositeRiskResult["severity"];
  if (agents_flagging.length >= 3 || (agents_flagging.length >= 2 && hasCriticalSignal)) {
    severity = "critical";
  } else if (agents_flagging.length >= 2 || (agents_flagging.length >= 1 && hasCriticalSignal)) {
    severity = "high";
  } else if (agents_flagging.length >= 1 && hasHighSignal) {
    severity = "high";
  } else if (agents_flagging.length >= 1 && inDistress) {
    severity = "high";
  } else if (agents_flagging.length >= 1) {
    severity = "medium";
  } else {
    severity = "info";
  }

  // Build rationale
  const parts: string[] = [];

  if (adjustments.length > 0) {
    parts.push(`Threshold adjusted from ${BASE_THRESHOLD}% to ${adjusted_threshold}% due to: ${adjustments.join(", ")}.`);
  } else {
    parts.push(`No active signals; utilization threshold remains at ${BASE_THRESHOLD}%.`);
  }

  if (utilization_pct >= adjusted_threshold) {
    parts.push(`Utilization ${utilization_pct}% meets or exceeds adjusted threshold ${adjusted_threshold}%.`);
  }

  if (inDistress && hasActiveSignals) {
    parts.push(`Distress credit score (${credit_score}) with active signals — immediate review warranted.`);
  }

  if (agents_flagging.length >= 2) {
    parts.push(`${agents_flagging.length} agents flagging (${agents_flagging.join(", ")}) — multi-signal convergence.`);
  }

  if (!recommend_action) {
    parts.push("No action required at this time.");
  }

  return {
    adjusted_threshold,
    recommend_action,
    severity,
    rationale: parts.join(" "),
    adjustments,
  };
}
