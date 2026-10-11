/**
 * Edge-function auth helper. Functions that change data on behalf of a person
 * (onboarding, approvals, settings) call requireUser() first. It verifies the
 * caller's Supabase JWT and loads their CreditPilot role from app_users.
 *
 * Existing agents keep verify_jwt=false and are not affected.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AppRole = "admin" | "credit_manager" | "credit_analyst" | "sales" | "viewer";

export interface AuthedUser {
  user_id: string;
  email: string;
  display_name: string;
  role: AppRole;
  is_demo: boolean;
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

/** Throws AuthError(401) when not signed in, AuthError(403) when the role is not allowed. */
export async function requireUser(req: Request, roles?: AppRole[]): Promise<AuthedUser> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new AuthError(401, "Sign in required");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) throw new AuthError(401, "Sign in required");

  const { data: appUser, error } = await admin
    .from("app_users")
    .select("user_id, email, display_name, role, is_demo, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error || !appUser || !appUser.active) throw new AuthError(403, "No CreditPilot access for this account");
  if (roles && !roles.includes(appUser.role as AppRole)) throw new AuthError(403, `Role ${appUser.role} is not allowed to do this`);

  return { user_id: appUser.user_id, email: appUser.email, display_name: appUser.display_name, role: appUser.role as AppRole, is_demo: appUser.is_demo };
}
