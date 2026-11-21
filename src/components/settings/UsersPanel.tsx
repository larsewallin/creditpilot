/**
 * Settings › Users and authorities: each user's role and how large a credit limit they may
 * approve (founder, 2026-11-21). Empty = the role's amount from the policy
 * (Credit policy › Approval authority). Only admins change these; every change is logged.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { db, type SettingsAnswer } from "@/lib/onboarding";
import { setUser } from "@/lib/policy";
import { authorityOf, authorityText } from "@/lib/authority";

const ROLES: [string, string][] = [
  ["admin", "Admin"], ["credit_manager", "Credit manager"], ["credit_analyst", "Credit analyst"], ["sales", "Sales"], ["viewer", "Viewer"],
];
const ROLE_NOTE: Record<string, string> = {
  admin: "Everything, including users, roles and the policy.",
  credit_manager: "Approves limits within authority; changes the policy.",
  credit_analyst: "Runs applications, asks the CIA, uploads AR; approves limits within authority.",
  sales: "Reads; cannot approve.",
  viewer: "Reads; cannot approve.",
};

interface UserRow { user_id: string; display_name: string; email: string; role: string; is_demo: boolean; active: boolean; approval_limit_usd: number | null }

export function UsersPanel({ data }: { data: SettingsAnswer }) {
  const { appUser } = useAuth();
  const isAdmin = !!appUser && appUser.role === "admin" && !appUser.is_demo;
  const qc = useQueryClient();
  const approvals = (data.settings as { policy?: { approvals?: Record<string, number> } }).policy?.approvals;
  const users = useQuery({
    queryKey: ["app-users"],
    queryFn: async () => {
      const { data: rows, error } = await db.from("app_users")
        .select("user_id, display_name, email, role, is_demo, active, approval_limit_usd").order("display_name");
      if (error) throw new Error(error.message);
      return rows as UserRow[];
    },
  });
  const [own, setOwn] = useState<Record<string, string>>({});
  useEffect(() => {
    setOwn(Object.fromEntries((users.data ?? []).map((u) => [u.user_id, u.approval_limit_usd == null ? "" : String(u.approval_limit_usd)])));
  }, [users.data]);

  const save = useMutation({
    mutationFn: (v: { user_id: string; role?: string; approval_limit_usd?: number | null }) => setUser(v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["app-users"] }); toast.success("Saved."); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (users.isLoading) return <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Loading users…</p>;
  if (users.isError) return <p className="text-xs text-destructive">{(users.error as Error).message}</p>;

  return (
    <section className="bg-card rounded-xl border p-4 space-y-3 text-xs">
      <h2 className="text-sm font-semibold">Users and authorities</h2>
      <p className="text-muted-foreground">
        Approval authority is the largest credit limit a person may approve. Leave it empty to use their role's amount from
        Credit policy › Approval authority. Above it they recommend, and the action waits for someone whose authority covers it.
        Cutting a limit needs no authority. {isAdmin ? "Every change is logged with who made it." : "Only an admin can change these."}
      </p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-muted-foreground"><th className="py-1 font-normal">User</th><th className="font-normal">Role</th><th className="font-normal">Own authority (USD)</th><th className="font-normal">Can approve up to</th></tr>
        </thead>
        <tbody>
          {(users.data ?? []).filter((u) => u.active).map((u) => {
            const self = u.user_id === appUser?.user_id;
            const typed = own[u.user_id] ?? "";
            const changed = typed !== (u.approval_limit_usd == null ? "" : String(u.approval_limit_usd));
            return (
              <tr key={u.user_id} className="border-t align-top">
                <td className="py-2 pr-2"><div className="font-medium">{u.display_name}{self ? " (you)" : ""}</div><div className="text-muted-foreground">{u.email}</div></td>
                <td className="py-2 pr-2 w-44">
                  <Select value={u.role} disabled={!isAdmin || self} onValueChange={(role) => save.mutate({ user_id: u.user_id, role })}>
                    <SelectTrigger className="h-7 text-xs" aria-label={`Role of ${u.display_name}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-muted-foreground mt-1">{ROLE_NOTE[u.role]}</p>
                </td>
                <td className="py-2 pr-2 w-44">
                  <div className="flex gap-1">
                    <Input aria-label={`Own approval authority of ${u.display_name}`} value={typed} placeholder="Role's amount" inputMode="numeric" disabled={!isAdmin}
                      onChange={(e) => setOwn((o) => ({ ...o, [u.user_id]: e.target.value.replace(/[^0-9]/g, "") }))} className="h-7 text-xs font-mono" />
                    {isAdmin && changed && <Button size="sm" className="h-7 text-xs" disabled={save.isPending}
                      onClick={() => save.mutate({ user_id: u.user_id, approval_limit_usd: typed === "" ? null : Number(typed) })}>Save</Button>}
                  </div>
                </td>
                <td className="py-2 font-medium">{["sales", "viewer"].includes(u.role) ? "Cannot approve" : authorityText(authorityOf(u, approvals))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-muted-foreground">New users are added with scripts/create-demo-users.mjs --admin, or in Supabase Auth plus a row in app_users (docs/RUN_IT_YOURSELF.md, step 7).</p>
    </section>
  );
}
