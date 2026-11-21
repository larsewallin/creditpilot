/**
 * settings — protected gateway for company policy settings.
 *
 *   GET  (any signed-in user)  -> { settings: effective, overrides, score_providers, connectors (status from setting names only) }
 *   POST { key, value }        -> admin or credit_manager only; validates, saves, logs history
 *   POST { key, reset: true }  -> admin or credit_manager only; removes the override (back to defaults)
 *   POST { preview: { key, value } }
 *                              -> any signed-in user: which customers' payment health, limit-use alert
 *                                 or overdue alert a policy change would change; nothing is saved
 *   POST { assign_group: { customer_id, group } }
 *                              -> admin or credit_manager only; puts a customer in a policy group (null: none)
 *   POST { set_user: { user_id, role?, approval_limit_usd? } }
 *                              -> admin only; a user's role and own approval amount (null: the role's amount)
 *   Demo accounts (app_users.is_demo) get 403 on every POST: the demo's settings are shared.
 *
 * The browser never writes company_settings directly (no write policy).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { AuthError, requireUser } from "../_shared/auth.ts";
import { effectiveSettings, validateSetting } from "../_shared/onboarding/settings_validate.ts";
import { PROVIDER_LIST } from "../_shared/onboarding/score_providers.ts";
import { AGENTS } from "../_shared/scheduling/schedule.ts";
import { CATEGORIES, connectorStatuses } from "../_shared/connectors.ts";
import { effectiveGroups, effectivePolicy } from "../_shared/policy/policy.ts";
import { previewPolicyChange } from "../_shared/policy/preview.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const load = async () => {
      const { data, error } = await db.from("company_settings").select("key, value");
      if (error) throw new Error(error.message);
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    };

    if (req.method === "GET") {
      await requireUser(req);
      const overrides = await load();
      const { data: lists } = await db.from("sanctions_list_status").select("*");
      const { data: inst } = await db.from("instance_settings").select("public_demo").maybeSingle();
      const demoMode = Deno.env.get("DEMO_MODE") === "true";
      const publicDemo = !!inst?.public_demo;
      return json({
        // A production install (DEMO_MODE off) whose database still lets signed-out
        // visitors read (public_demo on) exposes its data: Settings shows it in red.
        instance_warning: !demoMode && publicDemo
          ? "This database is marked as a public demo, so anyone can read it without signing in. Run in the SQL editor: update instance_settings set public_demo = false;"
          : demoMode && !publicDemo
            ? "DEMO_MODE is on but the database is private: signed-out demo visitors will see empty pages."
            : null,
        // Names only: whether each data source's setting is present, never its value.
        connectors: connectorStatuses((n) => !!Deno.env.get(n)),
        connector_categories: CATEGORIES,
        sanctions_lists: lists ?? [],
        settings: effectiveSettings(overrides), overrides, score_providers: PROVIDER_LIST,
        agents: AGENTS.map(({ key, label, stage }) => ({ key, label, stage })),
        demo: Deno.env.get("DEMO_MODE") === "true",
      });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await req.json().catch(() => null);

    // Preview: read-only, so any signed-in user (the demo too) may ask what a change would do.
    if (body?.preview) {
      await requireUser(req);
      const key = String(body.preview.key ?? "");
      if (!key.startsWith("policy.")) return json({ error: "Preview covers the credit policy (policy.*) only." }, 400);
      const problems = validateSetting(key, body.preview.value);
      if (problems.length) return json({ error: problems.join("; ") }, 400);
      const stored = await load();
      const proposed = { ...stored, [key]: body.preview.value };
      const today = new Date().toISOString().slice(0, 10);
      const [cust, tx, inv] = await Promise.all([
        db.from("customers").select("id, company_name, credit_limit, current_exposure, credit_rating_score, payment_terms_days, policy_group").eq("lifecycle_status", "active"),
        db.from("payment_transactions").select("customer_id, payment_date, days_to_pay, days_early_late, on_time, amount:amount_paid").order("payment_date", { ascending: false }).limit(50_000),
        db.from("invoices").select("customer_id, amount_outstanding, due_date, status").lt("due_date", today).gt("amount_outstanding", 0).limit(50_000),
      ]);
      const err = cust.error ?? tx.error ?? inv.error;
      if (err) throw new Error(err.message);
      const changes = previewPolicyChange(
        { customers: cust.data ?? [], transactions: tx.data ?? [], invoices: inv.data ?? [], today },
        { policy: effectivePolicy(stored), groups: effectiveGroups(stored) },
        { policy: effectivePolicy(proposed), groups: effectiveGroups(proposed) },
      );
      return json({ changes, customers: (cust.data ?? []).length });
    }

    const user = await requireUser(req, ["admin", "credit_manager"]);
    if (user.is_demo) return json({ error: "Demo accounts can look at the settings but not change them." }, 403);

    // Users and authorities: admins only; nobody changes their own role (no accidental lock-out).
    if (body?.set_user) {
      if (user.role !== "admin") return json({ error: "Only an admin can change users' roles and approval authority." }, 403);
      const id = String(body.set_user.user_id ?? "");
      const update: Record<string, unknown> = {};
      if ("role" in body.set_user) {
        const role = String(body.set_user.role);
        if (!["admin", "credit_manager", "credit_analyst", "sales", "viewer"].includes(role)) return json({ error: `Unknown role "${role}".` }, 400);
        if (id === user.user_id) return json({ error: "You cannot change your own role; ask another admin." }, 400);
        update.role = role;
      }
      if ("approval_limit_usd" in body.set_user) {
        const v = body.set_user.approval_limit_usd;
        if (v !== null && !(typeof v === "number" && Number.isFinite(v) && v >= 0)) return json({ error: "Approval authority must be an amount of 0 or more, or empty for the role's amount." }, 400);
        update.approval_limit_usd = v === null ? null : Math.round(v);
      }
      if (!Object.keys(update).length) return json({ error: "Nothing to change." }, 400);
      const { data: row, error } = await db.from("app_users").update(update).eq("user_id", id).select("user_id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) return json({ error: "User not found." }, 404);
      await db.from("company_settings_history").insert({ key: `user:${id}`, value: update, changed_by: user.user_id });
      return json({ ok: true });
    }

    // A customer's policy group: one column on customers, logged like a setting change.
    if (body?.assign_group) {
      const id = String(body.assign_group.customer_id ?? "");
      const group = body.assign_group.group ?? null;
      const groups = effectiveGroups(await load());
      if (group !== null && !(typeof group === "string" && group in groups)) return json({ error: `Unknown policy group "${group}".` }, 400);
      const { data: row, error } = await db.from("customers").update({ policy_group: group }).eq("id", id).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) return json({ error: "Customer not found." }, 404);
      await db.from("company_settings_history").insert({ key: `customer_group:${id}`, value: { group }, changed_by: user.user_id });
      return json({ ok: true });
    }

    const key = String(body?.key ?? "");

    if (body?.reset === true) {
      const problems = validateSetting(key, {});
      if (problems.length) return json({ error: problems.join("; ") }, 400);
      const { error } = await db.from("company_settings").delete().eq("key", key);
      if (error) throw new Error(error.message);
      await db.from("company_settings_history").insert({ key, value: {}, changed_by: user.user_id });
    } else {
      const problems = validateSetting(key, body?.value);
      if (problems.length) return json({ error: problems.join("; ") }, 400);
      const { error } = await db.from("company_settings").upsert({
        key, value: body.value, updated_by: user.user_id, updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      await db.from("company_settings_history").insert({ key, value: body.value, changed_by: user.user_id });
    }

    const overrides = await load();
    return json({ ok: true, settings: effectiveSettings(overrides), overrides });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
