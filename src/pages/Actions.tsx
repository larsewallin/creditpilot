import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_MODE } from "@/lib/constants";
import { initDemo } from "@/lib/initDemo";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AgentPill } from "@/components/AgentPill";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Actions() {
  const queryClient = useQueryClient();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [resetting, setResetting] = useState(false);

  // ── Pending Actions ─────────────────────────────────────────────────────────
  const { data: pendingActions, refetch: refetchPending } = useQuery({
    queryKey: ["actions-pending"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_actions")
        .select("*, customers(company_name, ticker, credit_limit)")
        .eq("status", "pending")
        .eq("is_demo", true)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  // ── Completed Actions ────────────────────────────────────────────────────────
  const { data: completedActions } = useQuery({
    queryKey: ["actions-completed"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_actions")
        .select("*, customers(company_name, ticker)")
        .eq("is_demo", true)
        .in("status", ["approved", "rejected"])
        .order("reviewed_at", { ascending: false });
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  // ── Approve ─────────────────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async ({ action, note }: { action: any; note: string }) => {
      await supabase.from("pending_actions").update({
        status: "approved",
        reviewed_by: "demo_user",
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      }).eq("id", action.id);

      if (action.action_type === "CREDIT_LIMIT_REDUCTION" && action.proposed_value != null) {
        await supabase.from("customers").update({ credit_limit: action.proposed_value }).eq("id", action.customer_id);
      }

      await supabase.from("credit_actions").insert({
        customer_id: action.customer_id,
        action_date: new Date().toISOString().split("T")[0],
        action_type: action.action_type,
        description: `Approved. ${note ? note + ". " : ""}${action.rationale ?? ""}`,
        agent_name: action.agent_name,
      });
    },
    onSuccess: () => {
      refetchPending();
      queryClient.invalidateQueries({ queryKey: ["pending-actions-count"] });
      queryClient.invalidateQueries({ queryKey: ["actions-completed"] });
      queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
      setApprovingId(null);
      setApproveNote("");
      toast.success("Action approved");
    },
  });

  // ── Reject ──────────────────────────────────────────────────────────────────
  const rejectMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      await supabase.from("pending_actions").update({
        status: "rejected",
        reviewed_by: "demo_user",
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      }).eq("id", id);
    },
    onSuccess: () => {
      refetchPending();
      queryClient.invalidateQueries({ queryKey: ["pending-actions-count"] });
      queryClient.invalidateQueries({ queryKey: ["actions-completed"] });
      setRejectingId(null);
      setRejectNote("");
      toast.success("Action rejected");
    },
  });

  // ── Reset Demo ──────────────────────────────────────────────────────────────
  const resetDemo = async () => {
    setResetting(true);
    try {
      await initDemo();
      queryClient.invalidateQueries();
      toast.success("Demo reset successfully");
    } catch {
      toast.error("Failed to reset demo");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6 pb-48">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Actions</h1>
          <p className="text-xs text-muted-foreground mt-1">
            AI-recommended actions awaiting your approval.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Demo
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
              <AlertDialogDescription>
                This will restore all pending actions, SEC alerts, credit limits, and news reviewed state.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={resetDemo}
                disabled={resetting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {resetting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Pending Actions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Actions Awaiting Approval
          </h2>
          {(pendingActions?.length ?? 0) > 0 && (
            <span className="bg-severity-critical text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {pendingActions!.length}
            </span>
          )}
        </div>

        {!pendingActions || pendingActions.length === 0 ? (
          <div className="flex items-center justify-center h-24 border border-dashed rounded-xl text-muted-foreground text-sm">
            No pending actions.
          </div>
        ) : (
          <div className="space-y-3">
            {(pendingActions as any[]).map((action) => {
              const cust = action.customers;
              const isApprovingThis = approvingId === action.id;
              const isRejectingThis = rejectingId === action.id;
              return (
                <div key={action.id} className="bg-card rounded-xl border p-4 space-y-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-agent-aging/15 text-agent-aging border-0 text-[10px]">
                      ⚠ PENDING APPROVAL
                    </Badge>
                    <AgentPill agentName={action.agent_name} />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {cust?.company_name}{" "}
                    {cust?.ticker && (
                      <span className="text-muted-foreground font-normal">({cust.ticker})</span>
                    )}
                  </p>
                  <p className="text-foreground">
                    Action:{" "}
                    <span className="font-medium capitalize">
                      {action.action_type?.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </p>
                  {action.action_type === "CREDIT_LIMIT_REDUCTION" && (
                    <p className="font-mono text-foreground">
                      {formatCurrency(action.current_value)} → {formatCurrency(action.proposed_value)}
                    </p>
                  )}
                  {action.rationale && (
                    <p className="text-muted-foreground italic">"{action.rationale}"</p>
                  )}
                  <p className="text-muted-foreground text-[10px]">
                    Created {format(new Date(action.created_at), "MMM d, HH:mm")}
                  </p>

                  {isApprovingThis ? (
                    <div className="space-y-2">
                      <Input
                        placeholder="Add a note (optional)"
                        value={approveNote}
                        onChange={(e) => setApproveNote(e.target.value)}
                        className="text-xs h-8"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-risk-current hover:bg-risk-current/90 text-primary-foreground"
                          onClick={() => approveMutation.mutate({ action, note: approveNote })}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          Confirm Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => { setApprovingId(null); setApproveNote(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : isRejectingThis ? (
                    <div className="space-y-2">
                      <Input
                        placeholder="Add a note (optional)"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        className="text-xs h-8"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          onClick={() => rejectMutation.mutate({ id: action.id, note: rejectNote })}
                          disabled={rejectMutation.isPending}
                        >
                          {rejectMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          Confirm Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => { setRejectingId(null); setRejectNote(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-risk-current hover:bg-risk-current/90 text-primary-foreground"
                        onClick={() => { setApprovingId(action.id); setRejectingId(null); setRejectNote(""); }}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-severity-critical border-severity-critical/30"
                        onClick={() => { setRejectingId(action.id); setApprovingId(null); setApproveNote(""); }}
                      >
                        <XCircle className="h-3 w-3 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed Actions */}
      {(completedActions?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Completed
          </h2>
          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left p-3 font-medium">Customer</th>
                  <th className="text-left p-3 font-medium">Action</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Note</th>
                  <th className="text-left p-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(completedActions as any[]).map((action) => {
                  const cust = action.customers;
                  return (
                    <tr key={action.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="p-3">
                        <span className="font-medium text-xs">{cust?.company_name ?? "—"}</span>
                        {cust?.ticker && (
                          <span className="text-muted-foreground text-[10px] ml-1.5">{cust.ticker}</span>
                        )}
                      </td>
                      <td className="p-3 text-xs capitalize text-muted-foreground">
                        {action.action_type?.replace(/_/g, " ").toLowerCase()}
                      </td>
                      <td className="p-3">
                        {action.status === "approved" ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-400/30 text-[10px] h-5">
                            Approved
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px] h-5">
                            Rejected
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">
                        {action.review_note ?? <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {action.reviewed_at
                          ? format(new Date(action.reviewed_at), "MMM d, HH:mm")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
