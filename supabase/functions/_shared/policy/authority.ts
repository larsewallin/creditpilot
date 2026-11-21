/**
 * Approval authority: who may approve a credit limit of a given size (founder, 2026-11-21).
 *   A person's own amount (app_users.approval_limit_usd) if set, else their role's amount in
 *   policy.approvals; 0 = no ceiling. Sales and viewers never approve.
 * Pure: no database. Cutting a limit lowers risk and needs no authority; setting or raising one does.
 */
import type { CreditPolicy } from "./defaults.ts";

export type Role = "admin" | "credit_manager" | "credit_analyst" | "sales" | "viewer";
export const APPROVER_ROLES: Role[] = ["admin", "credit_manager", "credit_analyst"];

/** Largest limit this person may approve, in USD: Infinity = no ceiling, 0 = cannot approve. */
export function authorityOf(user: { role: string; approval_limit_usd?: number | null }, policy: CreditPolicy): number {
  if (!APPROVER_ROLES.includes(user.role as Role)) return 0;
  const own = user.approval_limit_usd;
  const amount = own != null ? Number(own) : Number(policy.approvals[`${user.role}_usd` as keyof CreditPolicy["approvals"]] ?? 0);
  return amount === 0 && own == null ? Infinity : amount;
}

/** Whether this person may approve a resulting limit of `limitUsd` (from `currentUsd`). */
export function mayApprove(user: { role: string; approval_limit_usd?: number | null }, policy: CreditPolicy, limitUsd: number, currentUsd = 0): boolean {
  if (!APPROVER_ROLES.includes(user.role as Role)) return false;
  if (limitUsd <= currentUsd) return true; // a cut or no change lowers risk
  return limitUsd <= authorityOf(user, policy);
}

export const authorityText = (a: number) => a === Infinity ? "no ceiling" : `$${Math.round(a).toLocaleString("en-US")}`;
