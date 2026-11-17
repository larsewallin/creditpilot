/**
 * Who may start an agent run.
 *
 * Demo (DEMO_MODE=true): anyone, as before. The demo's agents only read seed data and
 * rebuild the same demo events; visitors' browsers start them on Reset Demo.
 *
 * Production (DEMO_MODE not "true"): only the agent scheduler (x-scheduler-secret) or a
 * signed-in admin / credit manager. Without this, anyone holding the public anon key
 * (it is in every browser bundle) could start runs that cost money (news search, AI).
 */
import { AuthError, requireUser } from "./auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-scheduler-secret, x-internal-test-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** null = allowed; otherwise the Response to return. */
export async function agentCallerProblem(req: Request): Promise<Response | null> {
  if (Deno.env.get("DEMO_MODE") === "true") return null;
  if (sameSecret(req.headers.get("x-scheduler-secret") ?? "", Deno.env.get("SCHEDULER_SECRET") ?? "")) return null;
  try {
    await requireUser(req, ["admin", "credit_manager"]);
    return null;
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    const error = e instanceof AuthError ? e.message : "Sign in required";
    return new Response(JSON.stringify({ error }), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  }
}
