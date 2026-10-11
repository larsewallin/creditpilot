/**
 * Sign-in state for the app.
 *
 * Accounts are created by an admin only (scripts/create-demo-users.mjs or the
 * Supabase dashboard). There is deliberately no sign-up anywhere in the UI,
 * and sign-ups must also be disabled in Supabase (Authentication settings).
 *
 * Pages stay viewable when signed out during the transition (build plan §3).
 * Actions that change data (onboarding, approvals, settings) will require a
 * signed-in user with the right role — wrap those in <RequireAuth>.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "credit_manager" | "credit_analyst" | "sales" | "viewer";

export interface AppUser {
  user_id: string;
  email: string;
  display_name: string;
  role: AppRole;
  is_demo: boolean;
  active: boolean;
}

interface AuthState {
  session: Session | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadAppUser(userId: string): Promise<AppUser | null> {
  // app_users is not in the generated Supabase types yet (types regeneration is a backlog item).
  const { data, error } = await supabase
    .from("app_users" as never)
    .select("user_id, email, display_name, role, is_demo, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[auth] app_users lookup failed:", error.message);
    return null;
  }
  const u = data as AppUser | null;
  return u && u.active ? u : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const apply = async (s: Session | null) => {
      const u = s ? await loadAppUser(s.user.id) : null;
      if (cancelled) return;
      // A valid Supabase login without an active app_users row is not a CreditPilot user.
      if (s && !u) {
        await supabase.auth.signOut();
        setSession(null);
        setAppUser(null);
      } else {
        setSession(s);
        setAppUser(u);
      }
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer: calling Supabase inside this callback can deadlock the client.
      setTimeout(() => apply(s), 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return "Email or password is incorrect.";
    const u = await loadAppUser(data.user.id);
    if (!u) {
      await supabase.auth.signOut();
      return "This account does not have access to CreditPilot. Ask your administrator.";
    }
    return null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, appUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Wrap a route or section that requires a signed-in user (optionally with one of `roles`). */
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: AppRole[] }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!appUser) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(appUser.role)) {
    return <p className="text-sm text-muted-foreground">Your role ({appUser.role.replace("_", " ")}) does not have access to this page.</p>;
  }
  return <>{children}</>;
}

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  credit_manager: "Credit manager",
  credit_analyst: "Credit analyst",
  sales: "Sales",
  viewer: "Viewer",
};
