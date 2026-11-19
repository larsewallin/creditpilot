/**
 * Act from the answer (CIA v2): for each customer the question names, open it, and decide the
 * action an agent proposed for it, right under the answer. Decisions go through demo-actions,
 * the same path as the Actions page (open in the demo, a credit manager in production).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_MODE } from "@/lib/constants";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const money = (v: number | null) => (v == null ? "—" : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(v % 1_000_000 ? 2 : 1).replace(/\.?0+$/, "")}M` : `$${Math.round(v).toLocaleString("en-US")}`);
const ACTION_LABEL: Record<string, string> = {
  CREDIT_LIMIT_REDUCTION: "Lower the credit limit",
  CREDIT_LIMIT_INCREASE: "Raise the credit limit",
  NEW_CREDIT_LIMIT: "Set a credit limit",
  CREDIT_HOLD: "Put on credit hold",
  PAYMENT_TERMS_CHANGE: "Change payment terms",
};

interface PendingAction { id: string; customer_id: string; action_type: string; current_value: number | null; proposed_value: number | null; agent_name: string | null; rationale: string | null; severity: string | null }

export function AnswerActions({ customers }: { customers?: { id: string; company_name: string }[] }) {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  const canDecide = DEMO_MODE || (!!appUser && ["admin", "credit_manager"].includes(appUser.role));
  const ids = (customers ?? []).map((c) => c.id).filter(Boolean);
  const [done, setDone] = useState<Record<string, "approved" | "rejected">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const pending = useQuery({
    queryKey: ["cia-pending-actions", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("pending_actions")
        .select("id, customer_id, action_type, current_value, proposed_value, agent_name, rationale, severity")
        .eq("status", "pending").eq("is_demo", DEMO_MODE).in("customer_id", ids);
      if (error) throw error;
      return (data ?? []) as PendingAction[];
    },
  });

  if (!ids.length) return null;

  const decide = async (a: PendingAction, verdict: "approve" | "reject") => {
    setBusy(a.id);
    try {
      const body = verdict === "approve"
        ? { action: "approve", pending_action_id: a.id, action_type: a.action_type, customer_id: a.customer_id, proposed_value: a.proposed_value, current_value: a.current_value, agent_name: a.agent_name, rationale: a.rationale, note: "Decided from a CIA answer" }
        : { action: "reject", pending_action_id: a.id, note: "Decided from a CIA answer" };
      const { error } = await supabase.functions.invoke("demo-actions", { body });
      if (error) throw error;
      setDone((d) => ({ ...d, [a.id]: verdict === "approve" ? "approved" : "rejected" }));
      qc.invalidateQueries({ queryKey: ["pending-actions-count"] });
      toast.success(verdict === "approve" ? "Approved" : "Rejected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the decision");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {(customers ?? []).map((c) => {
        const actions = (pending.data ?? []).filter((a) => a.customer_id === c.id);
        return (
          <div key={c.id} className="rounded-xl border bg-white p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-800 truncate">{c.company_name}</span>
              <Link to={`/customers?customer_id=${c.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                Open the customer<ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {actions.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
                <span className="font-medium">Proposed: {ACTION_LABEL[a.action_type] ?? a.action_type.replace(/_/g, " ").toLowerCase()}</span>
                {(a.current_value != null || a.proposed_value != null) && <span className="text-muted-foreground">{money(a.current_value)} → {money(a.proposed_value)}</span>}
                <span className="ml-auto flex items-center gap-1.5">
                  {done[a.id] ? (
                    <span className={done[a.id] === "approved" ? "text-emerald-700" : "text-muted-foreground"}>{done[a.id] === "approved" ? "Approved" : "Rejected"}</span>
                  ) : canDecide ? (
                    <>
                      <Button size="sm" className="h-7 text-xs" disabled={busy === a.id} onClick={() => decide(a, "approve")}>
                        {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === a.id} onClick={() => decide(a, "reject")}>
                        <X className="h-3 w-3 mr-1" />Reject
                      </Button>
                    </>
                  ) : (
                    <Link to="/actions" className="text-primary hover:underline">Review on Actions</Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
