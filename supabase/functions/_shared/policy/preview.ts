/**
 * What a policy change would change, before it is saved (Settings › Credit policy › Preview).
 * Pure: the caller passes the portfolio and both policies. Covers the rules that can be
 * re-run from stored data: payment health, the limit-use alert and the overdue alert. Rules
 * that need a fresh agent run (trend windows, score changes, composite risk, FX) take effect
 * on the agents' next run and are not previewed.
 */
import type { CreditPolicy, PolicyGroup } from "./defaults.ts";
import { policyFor } from "./policy.ts";
import { analysePaymentBehaviour, type PaymentTransaction } from "../skills/analytical/analyse-payment-behaviour.ts";

export interface PreviewCustomer {
  id: string;
  company_name: string;
  credit_limit: number | null;
  current_exposure: number | null;
  credit_rating_score: number | null;
  payment_terms_days: number | null;
  policy_group?: string | null;
}
export interface PreviewTransaction extends PaymentTransaction { customer_id: string }
export interface PreviewInvoice { customer_id: string; amount_outstanding: number; due_date: string; status: string | null }

export interface PolicyState { policy: CreditPolicy; groups: Record<string, PolicyGroup> }
export interface PreviewChange { customer_id: string; company_name: string; rule: string; before: string; after: string }

const CLOSED = new Set(["paid", "written_off", "pre_petition"]);

function health(c: PreviewCustomer, tx: PaymentTransaction[], rules: CreditPolicy) {
  return analysePaymentBehaviour(tx, rules.payments, Number(c.payment_terms_days) || 30);
}

function limitUseAlert(c: PreviewCustomer, tx: PaymentTransaction[], rules: CreditPolicy): string {
  const limit = Number(c.credit_limit) || 0;
  if (limit <= 0) return "none";
  const use = (Number(c.current_exposure) || 0) / limit * 100;
  if (use <= rules.utilization.high_pct) return "none";
  if (use > 100) return "critical (over the limit)";
  const b = health(c, tx, rules);
  const weak = (c.credit_rating_score != null && c.credit_rating_score < rules.utilization.weak_score_below)
    || b.health === "at_risk" || b.trend === "deteriorating";
  return weak ? "high" : "none";
}

function overdueAlert(c: PreviewCustomer, inv: PreviewInvoice[], rules: CreditPolicy, today: string): string {
  let total = 0, over90 = 0, worst = 0;
  for (const i of inv) {
    const days = Math.floor((Date.parse(today) - Date.parse(i.due_date)) / 86_400_000);
    if (days <= 0) continue;
    const amt = Number(i.amount_outstanding) || 0;
    total += amt;
    if (days > 90) over90 += amt;
    worst = Math.max(worst, days);
  }
  if (total <= 0) return "none";
  const limit = Number(c.credit_limit) || 0;
  if (total < Math.max(rules.overdue.materiality_usd, limit * rules.overdue.materiality_pct_of_limit / 100)) return "none (below the minimum)";
  if (over90 > 0) return limit <= 0 || over90 >= limit * rules.overdue.critical_min_pct_of_limit / 100 ? "critical" : "high";
  return worst > 60 ? "high" : worst > 30 ? "medium" : "low";
}

export function previewPolicyChange(
  data: { customers: PreviewCustomer[]; transactions: PreviewTransaction[]; invoices: PreviewInvoice[]; today: string },
  before: PolicyState,
  after: PolicyState,
): PreviewChange[] {
  const txBy = new Map<string, PreviewTransaction[]>();
  for (const t of data.transactions) (txBy.get(t.customer_id) ?? txBy.set(t.customer_id, []).get(t.customer_id)!).push(t);
  const invBy = new Map<string, PreviewInvoice[]>();
  for (const i of data.invoices) {
    if (CLOSED.has(String(i.status ?? ""))) continue;
    (invBy.get(i.customer_id) ?? invBy.set(i.customer_id, []).get(i.customer_id)!).push(i);
  }

  const out: PreviewChange[] = [];
  for (const c of data.customers) {
    // The same history the agent reads: the 24 latest payments.
    const tx = (txBy.get(c.id) ?? []).sort((a, b) => b.payment_date.localeCompare(a.payment_date)).slice(0, 24);
    const rb = policyFor(before.policy, before.groups, c.policy_group);
    const ra = policyFor(after.policy, after.groups, c.policy_group);
    const push = (rule: string, b: string, a: string) => { if (b !== a) out.push({ customer_id: c.id, company_name: c.company_name, rule, before: b, after: a }); };
    if (tx.length) push("Payment health", health(c, tx, rb).health, health(c, tx, ra).health);
    push("Limit-use alert", limitUseAlert(c, tx, rb), limitUseAlert(c, tx, ra));
    const inv = invBy.get(c.id) ?? [];
    if (inv.length) push("Overdue alert", overdueAlert(c, inv, rb, data.today), overdueAlert(c, inv, ra, data.today));
  }
  return out.sort((x, y) => x.company_name.localeCompare(y.company_name) || x.rule.localeCompare(y.rule));
}
