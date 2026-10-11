/**
 * settings — protected gateway for company policy settings.
 *
 *   GET  (any signed-in user)  -> { settings: effective, overrides }
 *   POST { key, value }        -> admin or credit_manager only; validates, saves, logs history
 *   POST { key, reset: true }  -> admin or credit_manager only; removes the override (back to defaults)
 *
 * The browser never writes company_settings directly (no write policy).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { AuthError, requireUser } from "../_shared/auth.ts";
import { effectiveSettings, validateSetting } from "../_shared/onboarding/settings_validate.ts";

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
      return json({ settings: effectiveSettings(overrides), overrides });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const user = await requireUser(req, ["admin", "credit_manager"]);
    const body = await req.json();
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
