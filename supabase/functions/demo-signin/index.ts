/**
 * demo-signin — the "Try it as" buttons on the sign-in page.
 *
 *   POST { persona: "credit_manager" | "credit_analyst" | "sales" }
 *     -> { token_hash }   the browser exchanges it with supabase.auth.verifyOtp({ type: "magiclink" })
 *
 * Only while DEMO_MODE=true (404 otherwise). Signs the visitor in as a shared demo
 * persona (app_users.is_demo = true). No email is sent and no password is shown.
 * Demo accounts can look at Settings but not change them (settings function).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { personaOf } from "../_shared/demo_personas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (Deno.env.get("DEMO_MODE") !== "true") return json({ error: "Not found" }, 404);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const persona = personaOf(body?.persona);
    if (!persona) return json({ error: "Unknown demo persona" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 30 demo sign-ins a day per address (pre-launch audit). Fails open on a counter error.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { data: n, error: rlErr } = await db.rpc("fn_increment_demo_signin_count", { p_ip_address: ip });
    if (rlErr) console.error("[demo-signin] rate limit check failed:", rlErr.message);
    else if (typeof n === "number" && n > 30) {
      return json({ error: "Too many demo sign-ins from your address today. Try again tomorrow." }, 429);
    }

    // generateLink creates the auth user if it does not exist yet; no email is sent.
    let link = await db.auth.admin.generateLink({ type: "magiclink", email: persona.email });
    if (link.error) {
      const created = await db.auth.admin.createUser({ email: persona.email, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID() });
      if (created.error) throw new Error(created.error.message);
      link = await db.auth.admin.generateLink({ type: "magiclink", email: persona.email });
      if (link.error) throw new Error(link.error.message);
    }
    const userId = link.data.user?.id;
    const tokenHash = link.data.properties?.hashed_token;
    if (!userId || !tokenHash) throw new Error("No sign-in token returned");

    const { error } = await db.from("app_users").upsert(
      { user_id: userId, email: persona.email, display_name: persona.display_name, role: persona.role, is_demo: true, active: true },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    return json({ token_hash: tokenHash });
  } catch (e) {
    console.error("[demo-signin]", e instanceof Error ? e.message : e);
    return json({ error: "Could not start the demo. Try again in a moment." }, 500);
  }
});
