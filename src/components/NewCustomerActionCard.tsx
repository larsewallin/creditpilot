/**
 * A NEW_CREDIT_LIMIT proposal (New Customer Onboarding) on the Actions page.
 * Shows requested / proposed / supportable and the cited memo. Deciding needs a
 * signed-in credit manager or admin; the onboarding function enforces the role,
 * the four-eyes rule and the notes, and activates the customer on approval.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface MemoSection { title: string; lines: string[]; sources: string[] }
interface Action {
  id: string;
  created_at: string;
  expires_at: string | null;
  proposed_value: number | null;
  requested_value: number | null;
  supportable_value: number | null;
  severity: string | null;
  reason_codes?: string[] | null;
  application_id?: string | null;
  memo: { headline: string; sections: MemoSection[] } | null;
  customers?: { company_name?: string } | null;
}

const SEVERITY: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-orange-500/15 text-orange-700",
  medium: "bg-amber-500/15 text-amber-700",
  info: "bg-emerald-500/15 text-emerald-700",
};

async function errorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try { const j = await ctx.json(); if (j?.error) return j.error; } catch { /* fall through */ }
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

export function NewCustomerActionCard({ action }: { action: Action }) {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  const [mode, setMode] = useState<"idle" | "approve" | "decline">("idle");
  const [amount, setAmount] = useState(String(action.proposed_value ?? ""));
  const [note, setNote] = useState("");
  const canDecide = !!appUser && (appUser.role === "credit_manager" || appUser.role === "admin");
  const isDecline = (action.proposed_value ?? 0) === 0;
  const sanctions = (action.reason_codes ?? []).includes("SANCTIONS_MATCH");
  const why = action.supportable_value == null
    ? (sanctions ? "No credit analysis: onboarding stopped at screening." : "No credit analysis was run.")
    : action.supportable_value === 0
      ? ((action.reason_codes ?? []).includes("SCORE_BAND_E") ? "Supportable is $0: the score is in band E (below 60)."
        : (action.reason_codes ?? []).includes("NO_CAP_BASIS") ? "Supportable is $0: no financials or bureau recommendation to base a limit on."
        : "Supportable is $0: the evidence supports no unsecured limit.")
      : null;

  const decide = useMutation({
    mutationFn: async (decision: "approve" | "decline") => {
      const { data, error } = await supabase.functions.invoke("onboarding", {
        body: {
          action: "decide", pending_action_id: action.id, decision, note,
          approved_value: decision === "approve" ? Number(amount.replace(/[^0-9.]/g, "")) : undefined,
        },
      });
      if (error) throw new Error(await errorMessage(error));
      return data as { decision: string; approved_limit_usd?: number; next?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      setMode("idle");
      setNote("");
      if (data.decision === "approved") toast.success(`Approved at ${formatCurrency(data.approved_limit_usd ?? 0)}. The customer is now monitored.`);
      else toast.success(data.next ?? "Declined");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="bg-card rounded-xl border p-4 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-primary/10 text-primary border-0 text-[10px]">NEW CUSTOMER</Badge>
        {action.severity && <Badge className={`border-0 text-[10px] ${SEVERITY[action.severity] ?? ""}`}>{action.severity}</Badge>}
        {action.expires_at && (
          <span className="text-muted-foreground text-[10px]">Decision due {format(new Date(action.expires_at), "MMM d")}</span>
        )}
      </div>
      <p className="text-sm font-semibold text-foreground">{action.customers?.company_name ?? "Prospect"}</p>
      <p className="text-foreground font-medium">{action.memo?.headline}</p>
      <div className="grid grid-cols-3 gap-2 font-mono">
        <div><div className="text-muted-foreground font-sans text-[10px]">Requested</div>{formatCurrency(action.requested_value ?? 0)}</div>
        <div><div className="text-muted-foreground font-sans text-[10px]">Proposed</div>{formatCurrency(action.proposed_value ?? 0)}</div>
        <div><div className="text-muted-foreground font-sans text-[10px]">Supportable</div>{action.supportable_value != null ? formatCurrency(action.supportable_value) : "—"}</div>
      </div>
      {why && <p className="text-muted-foreground">{why}</p>}

      {action.memo && (
        <details className="rounded-lg bg-secondary/40 p-3">
          <summary className="cursor-pointer font-medium">Credit memo</summary>
          <div className="mt-2 space-y-3">
            {action.memo.sections.map((s) => (
              <div key={s.title}>
                <p className="font-semibold">{s.title}</p>
                <ul className="list-disc pl-4 space-y-0.5">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                {s.sources.length > 0 && <p className="text-muted-foreground mt-1">Sources: {s.sources.join("; ")}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-muted-foreground text-[10px]">
        Proposed {format(new Date(action.created_at), "MMM d, HH:mm")} by CIA
        {action.application_id && <> · <Link to={`/new-customers/${action.application_id}`} className="underline">Open prospect</Link></>}
      </p>

      {sanctions ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            A sanctions match must be cleared or confirmed on the prospect's Screening tab before any approval.
          </p>
          {canDecide && mode !== "decline" && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-severity-critical border-severity-critical/30" onClick={() => setMode("decline")}>
              <XCircle className="h-3 w-3 mr-1" />Decline
            </Button>
          )}
          {canDecide && mode === "decline" && (
            <div className="space-y-2">
              <Textarea placeholder="Reason for declining (required; it goes into the applicant notice)" value={note}
                onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[60px]" />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => decide.mutate("decline")} disabled={decide.isPending}>
                  {decide.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}Confirm decline
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMode("idle")}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      ) : !canDecide ? (
        <p className="text-muted-foreground">
          {appUser ? "Only a credit manager can decide new-customer limits." : <><Link to="/login" className="underline">Sign in</Link> as a credit manager to decide.</>}
        </p>
      ) : mode === "approve" ? (
        <div className="space-y-2">
          <label className="block text-[10px] text-muted-foreground">Approved limit (USD)</label>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className="h-8 text-xs font-mono max-w-[200px]" />
          <Textarea placeholder={isDecline ? "Why approve against the recommendation (required)" : "Note (required if you change the amount)"} value={note}
            onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[60px]" />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={() => decide.mutate("approve")} disabled={decide.isPending}>
              {decide.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}Confirm approval
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMode("idle")}>Cancel</Button>
          </div>
        </div>
      ) : mode === "decline" ? (
        <div className="space-y-2">
          <Textarea placeholder="Reason for declining (required; it goes into the applicant notice)" value={note}
            onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[60px]" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => decide.mutate("decline")} disabled={decide.isPending}>
              {decide.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}Confirm decline
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMode("idle")}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs" onClick={() => setMode("approve")}>
            <CheckCircle2 className="h-3 w-3 mr-1" />{isDecline ? "Approve anyway" : "Approve"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs text-severity-critical border-severity-critical/30" onClick={() => setMode("decline")}>
            <XCircle className="h-3 w-3 mr-1" />Decline
          </Button>
        </div>
      )}
    </div>
  );
}
