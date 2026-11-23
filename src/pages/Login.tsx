import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, type DemoPersona } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/constants";

const PERSONAS: { key: DemoPersona; label: string; blurb: string }[] = [
  { key: "credit_manager", label: "Credit manager", blurb: "Approves or rejects proposed credit limit changes." },
  { key: "credit_analyst", label: "Credit analyst", blurb: "Approves limit cuts, and limits up to $250,000; a manager approves larger ones." },
  { key: "sales", label: "Sales rep", blurb: "Looks around: customers, alerts and the assistant." },
];

/** Sign-in only. Accounts are created by an administrator; there is no sign-up. */
export default function Login() {
  const { appUser, loading, signIn, tryDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/events";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && appUser) return <Navigate to={from} replace />;

  const onTry = async (persona: DemoPersona) => {
    setSubmitting(true);
    setError(null);
    const err = await tryDemo(persona);
    setSubmitting(false);
    if (err) setError(err);
    else navigate(from, { replace: true });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = await signIn(email.trim(), password);
    setSubmitting(false);
    if (err) setError(err);
    else navigate(from, { replace: true });
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">
            {DEMO_MODE
              ? <Link to="/events" className="hover:underline underline-offset-4" title="Back to the app">CreditPilot</Link>
              : "CreditPilot"}
          </h1>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        {DEMO_MODE && (
          <section aria-labelledby="try-demo" className="space-y-3 rounded-lg border bg-card p-6">
            <div className="space-y-1">
              <h2 id="try-demo" className="text-sm font-semibold">Try the demo</h2>
              <p className="text-xs text-muted-foreground">Fictional companies and figures, shared with other visitors. No sign-up needed.</p>
            </div>
            {PERSONAS.map((p) => (
              <Button key={p.key} type="button" variant="outline" className="w-full h-auto flex-col items-start py-2 text-left" disabled={submitting} onClick={() => onTry(p.key)}>
                <span className="font-medium">Try it as {p.label.toLowerCase()}</span>
                <span className="text-xs font-normal text-muted-foreground whitespace-normal">{p.blurb}</span>
              </Button>
            ))}
          </section>
        )}

        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Accounts are created by your administrator.
        </p>
        {DEMO_MODE && (
          <p className="text-center text-sm">
            <Link to="/events" className="text-primary hover:underline underline-offset-4">← Back to the app</Link>
          </p>
        )}
      </div>
    </div>
  );
}
