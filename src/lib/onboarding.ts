/**
 * New Customer Onboarding: shared front-end data access, saved views and labels.
 * Reads go straight to Supabase (signed-in RLS); every write goes through the
 * `onboarding` edge function, which checks role, four-eyes and notes.
 */
import { supabase } from "@/integrations/supabase/client";

// Generated Supabase types predate the onboarding tables; keep queries loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as { from: (table: string) => any };

export const STAGES = ["application", "completeness", "screening", "analysis", "decision", "active"] as const;
export const STAGE_LABEL: Record<string, string> = {
  application: "Application", completeness: "Completeness", screening: "Screening",
  analysis: "Analysis", decision: "Decision", approval: "Decision", conditions: "Decision", active: "Active",
};

export type ViewKey = "needs_decision" | "in_progress" | "waiting" | "approved" | "closed" | "all";
export const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "needs_decision", label: "Needs decision" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting", label: "Waiting on applicant" },
  { key: "approved", label: "Approved" },
  { key: "closed", label: "Declined & closed" },
  { key: "all", label: "All" },
];

export interface ApplicationRow {
  id: string;
  customer_id: string;
  stage: string;
  status: string;
  requested_limit_usd: number | null;
  requested_terms_days: number | null;
  decision_due_at: string | null;
  clock_started_at: string | null;
  updated_at: string;
  created_at: string;
  credit_assignee: string | null;
  sales_assignee: string | null;
  legal_name: string | null;
  country: string | null;
  screening_status: string | null;
  decision: string | null;
  approved_limit: string | null;
  route: string | null;
  error: string | null;
  // joined client-side
  proposal?: PendingProposal;
}

export interface PendingProposal {
  id: string;
  application_id: string;
  severity: string | null;
  proposed_value: number | null;
  supportable_value: number | null;
  status: string;
  headline: string | null;
}

export interface AppUserLite { user_id: string; display_name: string; role: string }

export function viewOf(a: ApplicationRow): ViewKey {
  if (a.status === "decided") {
    if (a.decision === "approved") return "approved";
    return "closed";
  }
  if (a.status === "withdrawn") return "closed";
  if (a.status === "incomplete") return "waiting";
  if (a.proposal?.status === "pending") return "needs_decision";
  if (a.stage === "screening" && (a.screening_status === "review" || a.screening_status === "fail")) return "needs_decision";
  return "in_progress";
}

/** What the application is waiting on, in a few words. */
export function waitingOn(a: ApplicationRow): string {
  switch (viewOf(a)) {
    case "approved": return "Monitored";
    case "closed": return a.route === "existing_customer_limit_review" ? "Existing customer: limit review" : "Declined";
    case "waiting": return "Applicant: missing items";
    case "needs_decision":
      if (a.stage === "screening") return a.screening_status === "fail" ? "Credit manager: sanctions match" : "Credit manager: screening review";
      return "Credit manager: limit decision";
    default: return a.error ? "Needs attention: a source failed" : "Agents working";
  }
}

export function regBClock(a: ApplicationRow): { label: string; days: number } | null {
  const DAY = 86_400_000;
  if (a.status === "decided" || a.status === "withdrawn") return null;
  if (a.status === "incomplete" && a.clock_started_at) {
    const days = Math.ceil((Date.parse(a.clock_started_at) + 30 * DAY - Date.now()) / DAY);
    return { label: `Applicant has ${Math.max(days, 0)} days`, days };
  }
  if (a.decision_due_at) {
    const days = Math.ceil((Date.parse(a.decision_due_at) - Date.now()) / DAY);
    return { label: days >= 0 ? `Decision due in ${days} days` : `Decision overdue by ${-days} days`, days };
  }
  return null;
}

export async function loadApplications(): Promise<ApplicationRow[]> {
  const { data, error } = await db.from("credit_applications")
    .select("id, customer_id, stage, status, requested_limit_usd, requested_terms_days, decision_due_at, clock_started_at, updated_at, created_at, credit_assignee, sales_assignee, legal_name:answers->>legal_name, country:answers->>country_code, screening_status:outcome->screening->>status, decision:outcome->decision->>decision, approved_limit:outcome->decision->>approved_limit_usd, route:outcome->>route, error:outcome->>error")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const apps = (data ?? []) as ApplicationRow[];
  const { data: props } = await db.from("pending_actions")
    .select("id, application_id, severity, proposed_value, supportable_value, status, headline:memo->>headline, created_at")
    .eq("action_type", "NEW_CREDIT_LIMIT")
    .order("created_at", { ascending: false });
  const latest = new Map<string, PendingProposal>();
  for (const p of (props ?? []) as PendingProposal[]) if (!latest.has(p.application_id)) latest.set(p.application_id, p);
  return apps.map((a) => ({ ...a, proposal: latest.get(a.id) }));
}

export async function loadAppUsers(): Promise<AppUserLite[]> {
  const { data } = await db.from("app_users").select("user_id, display_name, role").eq("active", true).order("display_name");
  return (data ?? []) as AppUserLite[];
}

export async function callOnboarding<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("onboarding", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = await ctx.json().catch(() => null);
      if (j?.error) throw new Error(j.error);
    }
    throw new Error(error.message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

export const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-orange-500/15 text-orange-700",
  medium: "bg-amber-500/15 text-amber-700",
  info: "bg-emerald-500/15 text-emerald-700",
};

export function initials(name?: string | null): string {
  return (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "–";
}
