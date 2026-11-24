/**
 * "Which customers have the highest credit risk?" — ranked in code, by how serious the risk
 * is, with the reason for each customer (review 2026-11-23).
 *
 * Before: fn_rank_portfolio_risk picked customers by an old fixed rule (score < 30, bankruptcy,
 * going concern, payments at risk) and sorted them by exposure, so the largest account came
 * first: Larkspur (Adequate, 5 days late) above a customer in Chapter 11. No reasons were shown,
 * and customers with a covenant waiver or over their limit were left out.
 *
 * Now, one tier per customer (its most serious), thresholds from the company's policy:
 *   1. In bankruptcy (open invoices from before a filing).
 *   2. Severe: a High risk score (policy limit_review.distress_score_below) or a going-concern doubt.
 *   3. A limit cut is waiting for approval (the policy's own decision), most severe first.
 *   4. Watch: over the limit, paying later and on time less than the policy's at-risk rate,
 *      or a high or critical warning (covenant waiver, CEO departure, serious news, large score drop).
 * Within a tier: the more severe proposal first, then the larger exposure.
 */

export interface RiskCustomer {
  id: string;
  company_name: string;
  credit_limit: number | null;
  current_exposure: number | null;
  credit_rating_score: number | null;
  payment_on_time_rate: number | null;
  payment_trend: string | null;
  payment_health: string | null;
}
export interface RiskEvent {
  customer_id: string | null;
  event_type: string;
  severity: string | null;
  title?: string | null;
}
export interface RiskPending { company_name: string; action_type?: string | null; current_value?: unknown; proposed_value?: unknown; severity?: string | null }
export interface RiskBankruptcy { company_name: string; pre_petition: number }

export interface RankedRisk {
  tier: 1 | 2 | 3 | 4;
  customer: RiskCustomer;
  reasons: string[];
}

export const RISK_TIER_TITLES: Record<RankedRisk["tier"], string> = {
  1: "In bankruptcy",
  2: "Severe warning signs",
  3: "Limit cut waiting for approval",
  4: "To watch",
};

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** A short plain reason for a high or critical event, or null when it is not one worth naming. */
function eventReason(e: RiskEvent): string | null {
  const sev = SEV_RANK[e.severity ?? ""] ?? 0;
  const t = (e.title ?? "").toLowerCase();
  switch (e.event_type) {
    case "GOING_CONCERN": return "going-concern doubt in its filings";
    case "COVENANT_WAIVER": return sev >= 3 ? "covenant waiver" : null;
    case "CEO_DEPARTURE": return sev >= 2 ? "CEO leaving" : null;
    case "SEC_OTHER":
      if (t.includes("covenant")) return "covenant waiver in its filings";
      if (t.includes("ceo") || t.includes("8-k")) return sev >= 2 ? "CEO leaving (8-K)" : null;
      return sev >= 3 ? "warning in its SEC filings" : null;
    case "NEWS_EVENT": return sev >= 3 ? "serious negative news" : null;
    case "CREDIT_RATING_DOWNGRADE": return sev >= 3 ? "a large score drop" : null;
    case "OVERDUE_AR": return sev >= 3 ? "invoices more than 60 days overdue" : null;
    default: return null;
  }
}

export function rankPortfolioRisk(
  customers: RiskCustomer[],
  events: RiskEvent[],
  pending: RiskPending[],
  bankruptcy: RiskBankruptcy[],
  rules: { distress_score_below: number; at_risk_on_time_below: number },
): RankedRisk[] {
  const bankrupt = new Map(bankruptcy.map((b) => [b.company_name, b.pre_petition]));
  const cuts = new Map<string, RiskPending>();
  for (const p of pending) {
    if (p.action_type && !/limit/i.test(p.action_type)) continue;
    const prev = cuts.get(p.company_name);
    if (!prev || (SEV_RANK[p.severity ?? ""] ?? 0) > (SEV_RANK[prev.severity ?? ""] ?? 0)) cuts.set(p.company_name, p);
  }
  const byCustomer = new Map<string, RiskEvent[]>();
  for (const e of events) {
    if (!e.customer_id) continue;
    byCustomer.set(e.customer_id, [...(byCustomer.get(e.customer_id) ?? []), e]);
  }

  const out: RankedRisk[] = [];
  for (const c of customers) {
    const exposure = Number(c.current_exposure ?? 0);
    const limit = Number(c.credit_limit ?? 0);
    if (!(exposure > 0)) continue;
    const use = limit > 0 ? exposure / limit : 0;
    const evs = byCustomer.get(c.id) ?? [];
    const reasons: string[] = [];

    const pre = bankrupt.get(c.company_name);
    const highRiskScore = c.credit_rating_score != null && c.credit_rating_score < rules.distress_score_below;
    const goingConcern = evs.some((e) => e.event_type === "GOING_CONCERN");
    const cut = cuts.get(c.company_name);
    const overLimit = use > 1;
    const onTime = c.payment_on_time_rate != null ? Number(c.payment_on_time_rate) : null;
    const payingWorse = c.payment_health === "at_risk" || (c.payment_trend === "deteriorating" && onTime != null && onTime < rules.at_risk_on_time_below);

    if (pre != null) reasons.push(`in bankruptcy; ${usd(pre)} owed from before the filing`);
    if (highRiskScore) reasons.push(`High risk score (${c.credit_rating_score}/100)`);
    if (goingConcern) reasons.push("going-concern doubt in its filings");
    if (cut) {
      const from = num(cut.current_value), to = num(cut.proposed_value);
      reasons.push(from != null && to != null ? `limit cut proposed (${usd(from)} → ${usd(to)})` : "limit cut proposed");
    }
    if (overLimit) reasons.push(`over its limit (${Math.round(use * 100)}% in use)`);
    if (payingWorse) reasons.push(`paying later${onTime != null ? `, on time ${Math.round(onTime * 100)}% of the time` : ""}`);
    for (const e of evs) {
      const r = eventReason(e);
      if (r && !reasons.includes(r)) reasons.push(r);
    }

    const tier: RankedRisk["tier"] | null =
      pre != null ? 1 : (highRiskScore || goingConcern) ? 2 : cut ? 3 : reasons.length > 0 ? 4 : null;
    if (tier == null) continue;
    out.push({ tier, customer: c, reasons: reasons.slice(0, 3) });
  }

  const cutSev = (r: RankedRisk) => SEV_RANK[cuts.get(r.customer.company_name)?.severity ?? ""] ?? 0;
  return out.sort((a, b) =>
    a.tier - b.tier
    || (a.tier === 3 ? cutSev(b) - cutSev(a) : 0)
    || Number(b.customer.current_exposure ?? 0) - Number(a.customer.current_exposure ?? 0));
}
