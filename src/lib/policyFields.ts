/**
 * Labels for every rule in the Trade Credit Policy (Settings › Credit policy).
 * Keys are "<settings key>:<field path>"; policyFields.test.ts fails when a rule in the
 * engine's defaults has no label here, so no rule is ever shown by its code name.
 *
 * kind "fraction": stored 0–1, shown and typed as a percent.
 */
export type FieldKind = "number" | "fraction";
export interface FieldInfo { label: string; unit?: string; kind?: FieldKind }

export interface PolicySectionInfo {
  key: string;            // company_settings key
  title: string;
  blurb: string;
  preview: boolean;       // the server can show what a change would change
}

export const POLICY_SECTIONS: PolicySectionInfo[] = [
  { key: "policy.payments", title: "Payments", preview: true,
    blurb: "How payment history is judged. Lateness is measured against each customer's own payment terms, so one rule fits net 15 and net 90 alike." },
  { key: "policy.payment_trend", title: "Payment trend", preview: false,
    blurb: "The last 90 days against the 90 before. Swings are a share of the customer's terms." },
  { key: "policy.overdue", title: "Overdue invoices", preview: true,
    blurb: "When overdue invoices raise an alert, and when over 90 days is critical." },
  { key: "policy.utilization", title: "Limit use", preview: true,
    blurb: "High limit use is an alert when over the limit, or with a weak signal: a low score, or payments at risk or getting slower." },
  { key: "policy.limit_review", title: "Limit reviews (existing customers)", preview: false,
    blurb: "When a limit cut is proposed and how large it may be. Every proposal waits for a person." },
  { key: "policy.composite", title: "Signals combined", preview: false,
    blurb: "Each open signal lowers the limit use at which action is recommended, by the points shown." },
  { key: "policy.score_change", title: "Score changes", preview: false,
    blurb: "How large a drop in a customer's own score must be to raise an alert." },
  { key: "policy.approvals", title: "Approval authority", preview: false,
    blurb: "The largest credit limit each role may approve (0 = no ceiling). An admin can give a person their own amount in Settings › Users. Above it, the person recommends and the action waits for someone whose authority covers it. Cutting a limit needs no authority. Sales and viewers never approve." },
  { key: "policy.fx", title: "Currency exposure", preview: false,
    blurb: "When receivables in another currency raise an alert." },
  { key: "onboarding.template", title: "New customers: what to ask for", preview: false,
    blurb: "Evidence asked of an applicant. Trade references depend on the company's size (latest revenue) and score." },
  { key: "onboarding.limits", title: "New customers: first limit", preview: false,
    blurb: "How the first limit is set: needs, balance-sheet caps reduced by the statements' quality, and the share the score allows." },
  { key: "onboarding.screening", title: "New customers: screening", preview: false,
    blurb: "When sanctions matches and fraud flags send an application to a person." },
];

export const FIELD_INFO: Record<string, FieldInfo> = {
  "policy.payments:grace_days": { label: "Grace days after the due date (still on time)", unit: "days" },
  "policy.payments:trend_pct_of_terms": { label: "Lateness change that counts as a trend", unit: "% of terms" },
  "policy.payments:at_risk_on_time_below": { label: "At risk: getting slower and paid on time less than", unit: "%", kind: "fraction" },
  "policy.payments:watch_on_time_below": { label: "Watch: paid on time less than", unit: "%", kind: "fraction" },
  "policy.payments:watch_avg_late_pct_of_terms": { label: "Watch: average lateness above", unit: "% of terms" },

  "policy.payment_trend:window_days": { label: "Window compared", unit: "days" },
  "policy.payment_trend:swing_pct_of_terms": { label: "Slower by at least (medium)", unit: "% of terms" },
  "policy.payment_trend:swing_high_pct_of_terms": { label: "Slower by at least (high)", unit: "% of terms" },
  "policy.payment_trend:swing_critical_pct_of_terms": { label: "Slower by at least (critical)", unit: "% of terms" },
  "policy.payment_trend:volatility_days": { label: "Erratic: spread of payment timing at least (high)", unit: "days" },
  "policy.payment_trend:volatility_critical_days": { label: "Erratic: spread at least (critical)", unit: "days" },

  "policy.overdue:materiality_usd": { label: "No alert below", unit: "USD" },
  "policy.overdue:materiality_pct_of_limit": { label: "No alert below", unit: "% of limit" },
  "policy.overdue:critical_min_pct_of_limit": { label: "Over 90 days is critical from", unit: "% of limit" },

  "policy.utilization:high_pct": { label: "Limit use alert above", unit: "% of limit" },
  "policy.utilization:critical_pct": { label: "Limit use critical above", unit: "% of limit" },
  "policy.utilization:weak_score_below": { label: "Weak score: below", unit: "score" },

  "policy.limit_review:distress_score_below": { label: "High risk: score below", unit: "score" },
  "policy.limit_review:concern_score_up_to": { label: "Elevated risk: score up to", unit: "score" },
  "policy.limit_review:high_overdue_pct_of_limit": { label: "Large overdue: over 90 days above", unit: "% of limit" },
  "policy.limit_review:high_utilization_pct": { label: "High limit use above", unit: "% of limit" },
  "policy.limit_review:critical_utilization_pct": { label: "Critical limit use above", unit: "% of limit" },
  "policy.limit_review:strategic_latitude_pct": { label: "Extra room for strategic accounts", unit: "points" },
  "policy.limit_review:max_reduction_usd": { label: "Largest single cut", unit: "USD" },
  "policy.limit_review:max_reduction_pct": { label: "Largest single cut", unit: "% of limit" },
  "policy.limit_review:high_risk_headroom_pct": { label: "High risk: limit cut to what is owed plus", unit: "% headroom" },
  "policy.limit_review:rejection_quiet_days": { label: "After a cut is rejected, no new proposal for", unit: "days" },
  "policy.limit_review:reopen_extra_cut_pct": { label: "…unless the new cut is deeper by at least", unit: "% of limit" },

  "policy.composite:base_threshold_pct": { label: "Act at limit use of", unit: "% (no signals)" },
  "policy.composite:floor_pct": { label: "Never lower than", unit: "%" },
  "policy.composite:negative_news_pts": { label: "Serious negative news", unit: "points" },
  "policy.composite:going_concern_pts": { label: "Going-concern doubt", unit: "points" },
  "policy.composite:covenant_waiver_pts": { label: "Covenant waiver", unit: "points" },
  "policy.composite:ceo_departure_pts": { label: "CEO departure", unit: "points" },
  "policy.composite:score_drop_pts": { label: "Score drop of 10 or more", unit: "points" },
  "policy.composite:macro_two_dimensions_pts": { label: "Country, industry or currency risk: 2 at once", unit: "points" },
  "policy.composite:macro_three_dimensions_pts": { label: "Country, industry and currency risk: 3 at once", unit: "points" },
  "policy.composite:distress_score_pts": { label: "Score High risk", unit: "points" },
  "policy.composite:concern_score_pts": { label: "Score Elevated risk", unit: "points" },

  "policy.score_change:ignore_below": { label: "Ignore changes under", unit: "points" },
  "policy.score_change:medium_from": { label: "Medium alert from a drop of", unit: "points" },
  "policy.score_change:high_from": { label: "High alert from", unit: "points" },
  "policy.score_change:critical_from": { label: "Critical alert from", unit: "points" },

  "policy.approvals:credit_analyst_usd": { label: "Credit analyst may approve up to", unit: "USD (0 = no ceiling)" },
  "policy.approvals:credit_manager_usd": { label: "Credit manager may approve up to", unit: "USD (0 = no ceiling)" },
  "policy.approvals:admin_usd": { label: "Admin may approve up to", unit: "USD (0 = no ceiling)" },

  "policy.fx:UNHEDGED_FLOOR_USD": { label: "Large unhedged exposure from", unit: "USD" },
  "policy.fx:UNHEDGED_SHARE_PCT": { label: "or from", unit: "% of the portfolio" },
  "policy.fx:ADVERSE_MOVE_PCT": { label: "Currency move that counts", unit: "%" },
  "policy.fx:HIGH_VOL_PCT": { label: "High volatility from", unit: "% a year" },
  "policy.fx:LONG_WINDOW_DAYS": { label: "Longer window", unit: "days" },
  "policy.fx:VOL_WINDOW_DAYS": { label: "Volatility window", unit: "days" },
  "policy.fx:COOLDOWN_DAYS": { label: "Wait before repeating an alert", unit: "days" },

  "onboarding.template:trade_references.large_revenue_usd": { label: "Large company: revenue from", unit: "USD" },
  "onboarding.template:trade_references.large": { label: "Trade references for a large company", unit: "references" },
  "onboarding.template:trade_references.mid_revenue_usd": { label: "Mid-size company: revenue from", unit: "USD" },
  "onboarding.template:trade_references.mid": { label: "Trade references for a mid-size company", unit: "references" },
  "onboarding.template:trade_references.small": { label: "Trade references for a smaller or unknown-size company", unit: "references" },
  "onboarding.template:trade_references.fewer_if_strong_or_better": { label: "Fewer for a Strong or better score", unit: "references" },
  "onboarding.template:statements_required_above_usd": { label: "A credit score is needed for requests above", unit: "USD" },
  "onboarding.template:guarantee_required_if_entity_younger_than_months": { label: "Personal guarantee if the company is younger than", unit: "months" },

  "onboarding.limits:needs_buffer_pct": { label: "Buffer on the customer's needs", unit: "%" },
  "onboarding.limits:working_capital_pct": { label: "Cap: share of working capital", unit: "%" },
  "onboarding.limits:net_worth_pct": { label: "Cap: share of net worth", unit: "%" },
  "onboarding.limits:statement_haircuts_pct.audited": { label: "Haircut: audited statements", unit: "%" },
  "onboarding.limits:statement_haircuts_pct.reviewed": { label: "Haircut: reviewed statements", unit: "%" },
  "onboarding.limits:statement_haircuts_pct.compiled": { label: "Haircut: compiled statements", unit: "%" },
  "onboarding.limits:statement_haircuts_pct.tax_return": { label: "Haircut: tax return", unit: "%" },
  "onboarding.limits:statement_haircuts_pct.management": { label: "Haircut: management accounts", unit: "%" },
  "onboarding.limits:macro_haircut_pct": { label: "Haircut: country or currency risk", unit: "%" },
  "onboarding.limits:score_multipliers.very_strong": { label: "Share of the cap: Very strong", unit: "%", kind: "fraction" },
  "onboarding.limits:score_multipliers.strong": { label: "Share of the cap: Strong", unit: "%", kind: "fraction" },
  "onboarding.limits:score_multipliers.adequate": { label: "Share of the cap: Adequate", unit: "%", kind: "fraction" },
  "onboarding.limits:score_multipliers.watch": { label: "Share of the cap: Watch", unit: "%", kind: "fraction" },
  "onboarding.limits:score_multipliers.elevated": { label: "Share of the cap: Elevated risk", unit: "%", kind: "fraction" },
  "onboarding.limits:score_multipliers.high_risk": { label: "Share of the cap: High risk", unit: "%", kind: "fraction" },
  "onboarding.limits:higher_limit_note_ratio": { label: "Note a higher supportable limit from", unit: "× the request" },
  "onboarding.limits:rounding_usd": { label: "Round limits down to", unit: "USD" },

  "onboarding.screening:name_match_review_threshold": { label: "Sanctions name match: review from", unit: "similarity 0–1" },
  "onboarding.screening:name_match_hit_threshold": { label: "Sanctions name match: hit from", unit: "similarity 0–1" },
  "onboarding.screening:fraud_flags_for_review": { label: "Fraud flags that send it to a person", unit: "flags" },
  "onboarding.screening:young_entity_months": { label: "Young company: under", unit: "months" },
  "onboarding.screening:young_entity_large_request_usd": { label: "Young company asking more than", unit: "USD" },
  "onboarding.screening:new_domain_months": { label: "New website domain: under", unit: "months" },
};

/** Every numeric field of a section, as dotted paths, in stored order. */
export function flatten(v: unknown, prefix = ""): [string, number][] {
  if (typeof v === "number") return [[prefix, v]];
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k));
}

/** Dotted paths and values back to the nested object the server stores. */
export function unflatten(entries: [string, number][]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of entries) {
    const parts = path.split(".");
    let o = out;
    for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
    o[parts[parts.length - 1]] = value;
  }
  return out;
}

export function fieldInfo(sectionKey: string, path: string): FieldInfo {
  return FIELD_INFO[`${sectionKey}:${path}`] ?? { label: path.replace(/[._]/g, " ") };
}

/** Shown value for an input: a fraction as a percent, rounded to avoid 0.85 × 100 = 85.00000000000001. */
export const toShown = (v: number, kind?: FieldKind) => kind === "fraction" ? String(Math.round(v * 10000) / 100) : String(v);
export const fromShown = (s: string, kind?: FieldKind) => kind === "fraction" ? Number(s) / 100 : Number(s);

/** The whole policy as a readable document (Settings › Credit policy › Download). */
export function policyMarkdown(
  sectionValue: (key: string) => unknown,
  groups: Record<string, { name: string; note: string; overrides: Record<string, unknown> }>,
  asOf: string,
): string {
  const out = [`# Trade Credit Policy`, ``, `As of ${asOf}. Exported from CreditPilot (Settings › Credit policy).`, ``,
    `## Score scale`, ``, `85–100 Very strong · 70–84 Strong · 55–69 Adequate · 40–54 Watch · 25–39 Elevated risk · 0–24 High risk`, ``];
  for (const s of POLICY_SECTIONS) {
    out.push(`## ${s.title}`, ``, s.blurb, ``, `| Rule | Value |`, `|---|---|`);
    for (const [p, v] of flatten(sectionValue(s.key))) {
      const f = fieldInfo(s.key, p);
      out.push(`| ${f.label} | ${toShown(v, f.kind)} ${f.unit ?? ""} |`);
    }
    out.push(``);
  }
  out.push(`## Customer groups`, ``, `A group changes only the rules listed; everything else follows the policy above.`, ``);
  for (const g of Object.values(groups)) {
    out.push(`### ${g.name}`, ``, ...(g.note ? [g.note, ``] : []));
    const rules = Object.entries(g.overrides ?? {}).flatMap(([s, v]) => flatten(v).map(([p, n]) => {
      const f = fieldInfo(`policy.${s}`, p);
      return `- ${POLICY_SECTIONS.find((x) => x.key === `policy.${s}`)?.title}: ${f.label}: ${toShown(n, f.kind)} ${f.unit ?? ""}`;
    }));
    out.push(...(rules.length ? rules : ["- No rules changed."]), ``);
  }
  return out.join("\n");
}
