/** Client calls for Settings › Credit policy (the `settings` edge function). */
import { supabase } from "@/integrations/supabase/client";

export interface PolicyChange { customer_id: string; company_name: string; rule: string; before: string; after: string }
export interface PolicyGroup { name: string; note: string; overrides: Record<string, Record<string, number>> }

async function call<T>(body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke("settings", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const j = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(j?.error ?? error.message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/** What saving this value would change for each customer; nothing is saved. */
export const previewPolicy = (key: string, value: unknown) =>
  call<{ changes: PolicyChange[]; customers: number }>({ preview: { key, value } });

/** Put a customer in a policy group (null: the company-wide policy). */
export const assignGroup = (customer_id: string, group: string | null) =>
  call<{ ok: true }>({ assign_group: { customer_id, group } });

/** Back to CreditPilot's defaults for one section. */
export const resetSetting = (key: string) => call<{ ok: true }>({ key, reset: true });
