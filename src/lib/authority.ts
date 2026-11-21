/** Approval authority in the browser (mirror of supabase/functions/_shared/policy/authority.ts). */
const APPROVERS = ["admin", "credit_manager", "credit_analyst"];

/** Largest limit this person may approve: Infinity = no ceiling, 0 = cannot approve. */
export function authorityOf(user: { role: string; approval_limit_usd?: number | null } | null, approvals?: Record<string, number>): number {
  if (!user || !APPROVERS.includes(user.role)) return 0;
  const own = user.approval_limit_usd;
  const amount = own != null ? Number(own) : Number(approvals?.[`${user.role}_usd`] ?? 0);
  return amount === 0 && own == null ? Infinity : amount;
}

export const authorityText = (a: number) => a === Infinity ? "no ceiling" : `$${Math.round(a).toLocaleString("en-US")}`;
export const isApprover = (role?: string) => !!role && APPROVERS.includes(role);
